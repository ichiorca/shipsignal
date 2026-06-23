"""Seed the canonical ``skills/**/SKILL.md`` library into ``skill_repo_snapshots`` as REFERENCE
data — not demo mock.

The repo SKILL.md files are the source of truth (constitution §2); ``skill_repo_snapshots`` is the
Aurora provenance mirror the dashboard's Skills page reads. The worker populates it during a content
run, but on a fresh / local DB the page is empty. This idempotent script snapshots the REAL library
so the dashboard reflects it on `pwsh local/bootstrap.ps1` (or `bash local/bootstrap.sh`).

Dependency-light by design: stdlib + psycopg ONLY (so it runs in a dashboard-only setup that
installed just db/requirements.txt — no pydantic / worker deps). It faithfully mirrors the worker's
own snapshot logic; KEEP IN SYNC with:
  * release_worker.content_nodes.parse_frontmatter / _skill_name / _content_hash / _BODY_EXCERPT_CHARS
  * release_worker.aurora_content.AuroraSkillSnapshotSink.upsert_snapshot
(The hash isn't required to byte-match a later worker run — the worker keys on a real commit sha and
supersedes these reference rows via is_active — but matching keeps the dashboard fingerprint stable.)

Run standalone:
  $env:DATABASE_URL = "postgresql://shipsignal:shipsignal@localhost:5434/shipsignal"
  python scripts/seed_reference_skills.py        # needs psycopg on the path

Env:
  DATABASE_URL       required — Postgres DSN (plain postgresql:// form).
  SEED_SKILLS_REPO   optional — repo id recorded on the snapshots (default 'acme/launchpad').
  SKILLS_ROOT        optional — skills dir (default '<repo>/skills').
  GITHUB_SHA         optional — checkout commit recorded as commit_sha (default 'unknown').
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
from pathlib import Path
from uuid import uuid4

import psycopg

_REPO_ROOT = Path(__file__).resolve().parent.parent
_BODY_EXCERPT_CHARS = 800  # mirrors release_worker.content_nodes._BODY_EXCERPT_CHARS


def parse_frontmatter(content: str) -> tuple[dict[str, object], str]:
    """Flat ``key: value`` frontmatter between leading ``---`` fences → (frontmatter, body).
    Mirrors release_worker.content_nodes.parse_frontmatter (true/false → bool; quotes stripped)."""
    lines = content.splitlines()
    if not lines or lines[0].strip() != "---":
        return {}, content.strip()
    frontmatter: dict[str, object] = {}
    index = 1
    while index < len(lines) and lines[index].strip() != "---":
        key, sep, raw_value = lines[index].partition(":")
        if sep:
            name = key.strip()
            value = raw_value.strip().strip("\"'")
            if name:
                lowered = value.lower()
                frontmatter[name] = (
                    lowered == "true" if lowered in ("true", "false") else value
                )
        index += 1
    body = "\n".join(lines[index + 1 :]).strip() if index < len(lines) else ""
    return frontmatter, body


def _skill_name(frontmatter: dict[str, object], skill_path: str) -> str:
    name = frontmatter.get("name")
    if isinstance(name, str) and name.strip():
        return name.strip()
    parts = [p for p in skill_path.replace("\\", "/").split("/") if p]
    return parts[-2] if len(parts) >= 2 else (parts[-1] if parts else "skill")


_UPSERT_SQL = """
    INSERT INTO skill_repo_snapshots (
        id, repo, skill_name, skill_path, skill_version, commit_sha,
        content_hash, frontmatter_json, body_excerpt, is_active
    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s, TRUE)
    ON CONFLICT (repo, skill_path, commit_sha) DO UPDATE
        SET is_active = TRUE,
            skill_version = EXCLUDED.skill_version,
            content_hash = EXCLUDED.content_hash,
            frontmatter_json = EXCLUDED.frontmatter_json,
            body_excerpt = EXCLUDED.body_excerpt,
            synced_at = now()
    RETURNING id
"""

_DEACTIVATE_SQL = """
    UPDATE skill_repo_snapshots SET is_active = FALSE
     WHERE repo = %s AND skill_path = %s AND commit_sha <> %s
"""

# Peer-parity versioned store (migration 0031): one row per skill with current_version + a
# versions{} map of {version: {body_md, content_hash, frontmatter, source}}. ADDITIVE in Phase 1 —
# the repo files stay the source of truth and nothing reads this for generation yet. body_md is the
# FULL SKILL.md text so a future reconcile can rewrite the file verbatim. On re-seed we MERGE the
# repo version into versions{} (keeping any evolved versions already present) and point
# current_version at the repo's; after the SoT flip this seeding becomes import-new-only so it
# never clobbers an evolved current_version.
_UPSERT_SKILLS_SQL = """
    INSERT INTO skills (name, skill_kind, status, current_version, versions)
    VALUES (%s, 'agent_skill', 'active', %s,
            jsonb_build_object(%s::text, jsonb_build_object(
                'body_md', %s::text,
                'content_hash', %s::text,
                'frontmatter', %s::jsonb,
                'source', 'repo-seed'
            )))
    ON CONFLICT (name) DO UPDATE
        SET versions = skills.versions || EXCLUDED.versions,
            -- Post-flip guard (DB is the source of truth): merge the repo version into versions{},
            -- but do NOT reset current_version once the skill has been EVOLVED via Gate #3
            -- promotion — only advance it while the active version is still repo-seeded. This makes
            -- re-seeding safe to run anytime without clobbering an evolved skill.
            current_version = CASE
                WHEN (skills.versions -> skills.current_version ->> 'source') = 'gate3-promotion'
                THEN skills.current_version
                ELSE EXCLUDED.current_version
            END,
            status = 'active',
            updated_at = now()
"""


# Capability→skill mapping (migration 0032). KEEP IN SYNC with
# release_worker.content_nodes._ARTIFACT_SPECS (artifact_type → format_skill) and
# release_worker.content_nodes._BRAND_VOICE_SKILL. Each capability (artifact type) grounds in its
# own format skill plus the shared brand-voice; both are seeded `required` with source
# 'code-default'. This is the floor the worker resolves an operator override (`capability_skills`
# rows with source 'operator-override') over — peer-parity with hindsight-guild-internal's
# SKILLS_BY_AGENT code default + agent_skill_overrides. Re-seeding is ON CONFLICT DO NOTHING so it
# never reverts an operator's edit; it only re-establishes a missing default.
_BRAND_VOICE_SKILL = "brand-voice"
_ARTIFACT_FORMAT_SKILLS: dict[str, str] = {
    "release_blog": "blog-format",
    "changelog_entry": "changelog-format",
    "sales_onepager": "sales-onepager-format",
    "linkedin_post": "social-post-format",
    "demo_script": "demo-script-format",
    "release_audio_digest": "audio-digest-format",
    "customer_email": "customer-email-format",
    "battlecard_delta": "battlecard-delta-format",
    "x_post": "x-post-format",
    "hackernews_post": "hackernews-post-format",
}

_UPSERT_CAPABILITY_SKILL_SQL = """
    INSERT INTO capability_skills (artifact_type, skill_name, required, source)
    VALUES (%s, %s, TRUE, 'code-default')
    ON CONFLICT (artifact_type, skill_name) DO NOTHING
"""


def _seed_capability_skills(conn: psycopg.Connection) -> int:
    """Seed the code-default capability→skill rows (idempotent, never clobbers an override)."""
    seeded = 0
    with conn.transaction(), conn.cursor() as cur:
        for artifact_type, format_skill in _ARTIFACT_FORMAT_SKILLS.items():
            for skill_name in (format_skill, _BRAND_VOICE_SKILL):
                cur.execute(_UPSERT_CAPABILITY_SKILL_SQL, (artifact_type, skill_name))
                seeded += cur.rowcount
    return seeded


def main() -> int:
    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        print("DATABASE_URL is required", file=sys.stderr)
        return 2

    skills_root = Path(os.environ.get("SKILLS_ROOT") or (_REPO_ROOT / "skills"))
    repo = os.environ.get("SEED_SKILLS_REPO", "acme/launchpad")
    commit_sha = os.environ.get("GITHUB_SHA") or "unknown"

    if not skills_root.is_dir():
        print(f"no skills dir at {skills_root}", file=sys.stderr)
        return 1
    skill_files = sorted(skills_root.rglob("SKILL.md"))
    if not skill_files:
        print(f"no SKILL.md found under {skills_root}/", file=sys.stderr)
        return 1

    seeded: list[str] = []
    with psycopg.connect(dsn, autocommit=True) as conn:
        for path in skill_files:
            content = path.read_text(encoding="utf-8")
            try:
                skill_path = path.relative_to(_REPO_ROOT).as_posix()
            except ValueError:
                skill_path = path.as_posix()
            frontmatter, body = parse_frontmatter(content)
            version = frontmatter.get("version")
            version_str = version if isinstance(version, str) else "1.0.0"
            name = _skill_name(frontmatter, skill_path)
            content_hash = hashlib.sha256(content.encode("utf-8")).hexdigest()
            frontmatter_json = json.dumps(frontmatter)
            snapshot_params = (
                uuid4().hex,
                repo,
                name,
                skill_path,
                version if isinstance(version, str) else None,
                commit_sha,
                content_hash,
                frontmatter_json,
                body[:_BODY_EXCERPT_CHARS],
            )
            # One transaction per skill: (1) the provenance snapshot (skill_repo_snapshots —
            # exactly one active per (repo, skill_path), mirroring the worker's sink), and (2) the
            # peer-parity versioned store (skills — current_version + versions{}). Both populated in
            # Phase 1; the repo file stays the source of truth until the §2/§5 flip.
            with conn.transaction(), conn.cursor() as cur:
                cur.execute(_UPSERT_SQL, snapshot_params)
                cur.execute(_DEACTIVATE_SQL, (repo, skill_path, commit_sha))
                cur.execute(
                    _UPSERT_SKILLS_SQL,
                    (
                        name,
                        version_str,
                        version_str,
                        content,
                        content_hash,
                        frontmatter_json,
                    ),
                )
            seeded.append(f"{name} v{version_str}")

        # Capability→skill mapping (migration 0032): seed the code-default per-artifact-type
        # selection so the Capabilities page reflects exactly what generation grounds in.
        capability_rows = _seed_capability_skills(conn)

    print(f"seeded {len(seeded)} reference skills for repo {repo}:")
    for label in sorted(seeded):
        print(f"  - {label}")
    print(
        f"seeded {capability_rows} new capability->skill mapping rows "
        f"({len(_ARTIFACT_FORMAT_SKILLS)} capabilities)"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
