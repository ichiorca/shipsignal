"""T2/T3/T4/T5 (spec 005) — the content_generation_graph nodes (PRD §5.3):
snapshot_active_skills → load_approved_features → generate_artifacts (blog + changelog)
→ persist_reviewable_artifacts.

Each node is a pure function of ``(inputs, port)`` — no langgraph/psycopg/boto3 import —
so it is unit-tested through the exact surface the graph invokes (anti-pattern #4). The
constitution's load-bearing rules are enforced *structurally*:

* §5 / §9.2 — the canonical skill is the repo SKILL.md: ``snapshot_active_skills`` only
  records provenance (path + commit + content hash) into Aurora; it never treats Aurora as
  the source of truth.
* §5 — no generation from unapproved work: ``load_approved_features`` refuses to proceed
  with zero approved features, and the reader returns only approved ones.
* §5 — model output is untrusted: each artifact body is validated through
  ``GeneratedArtifact`` before persist; a hallucinated/malformed payload fails closed.
* §5 — no self-approval: every persisted artifact is ``status='draft'``; Gate #2 (a later
  spec) is the only path to 'approved'.
* §18.3 — audit trail: each draft records model_id + prompt_version + skill content hashes,
  and a ``skill_usage_events`` row is written per (artifact, skill snapshot).
"""

from __future__ import annotations

import hashlib
from collections.abc import Callable

from pydantic import ValidationError

from release_worker.content_models import (
    ApprovedFeature,
    ArtifactDraft,
    GeneratedArtifact,
    MalformedArtifactOutputError,
    NoApprovedFeaturesError,
    RawSkill,
    SkillSnapshot,
    SkillUsageEvent,
)
from release_worker.content_ports import (
    ApprovedFeatureReader,
    ArtifactSink,
    SkillSnapshotSink,
)
from release_worker.model_client import ModelClient

_GRAPH_NAME = "content_generation_graph"
# Bumped whenever the prompt/template below changes so the audit trail (§18.3) records
# which template produced a draft.
PROMPT_VERSION = "content-gen-v1"
# Per §9.1 a body excerpt is enough provenance + prompt context; bound it so a huge skill
# file can't blow the prompt/token budget (constitution §6 cost/latency).
_BODY_EXCERPT_CHARS = 800

# --- T2 — snapshot active repo skills ---------------------------------------------


def parse_frontmatter(content: str) -> tuple[dict[str, str | bool], str]:
    """Parse a SKILL.md's leading ``---`` YAML-ish frontmatter into a flat scalar map.

    The PRD §9.1 frontmatter is all flat ``key: value`` scalars, so a tiny deterministic
    parser avoids a YAML dependency (dependency-policy: prefer stdlib). Untrusted input is
    handled defensively: only ``str``/``bool`` values are produced (``true``/``false`` →
    bool), nested structures are impossible, and a file with no/!malformed fence yields an
    empty map plus the whole content as body. Returns ``(frontmatter, body)``.
    """
    lines = content.splitlines()
    if not lines or lines[0].strip() != "---":
        return {}, content.strip()

    frontmatter: dict[str, str | bool] = {}
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


def _skill_name(frontmatter: dict[str, str | bool], skill_path: str) -> str:
    """The skill's name: the frontmatter ``name`` if a non-empty string, else the parent
    directory name (``skills/<name>/SKILL.md``) as a deterministic fallback."""
    name = frontmatter.get("name")
    if isinstance(name, str) and name.strip():
        return name.strip()
    parts = [p for p in skill_path.replace("\\", "/").split("/") if p]
    # …/<name>/SKILL.md → the parent of the file; fall back to the filename stem.
    return parts[-2] if len(parts) >= 2 else (parts[-1] if parts else "skill")


def _content_hash(content: str) -> str:
    """Tamper-evident hash of the whole SKILL.md (§10.5 content_hash)."""
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def snapshot_active_skills(
    repo: str,
    raw_skills: tuple[RawSkill, ...],
    sink: SkillSnapshotSink,
    new_snapshot_id: Callable[[], str],
) -> tuple[SkillSnapshot, ...]:
    """Snapshot the repo's active skills into Aurora (T2, PRD §9.3 step 2 / §10.5).

    For each SKILL.md: parse frontmatter, compute the content hash, and upsert a
    ``skill_repo_snapshots`` row keyed on (repo, skill_path, commit_sha). The upsert returns
    the *effective* id (the existing row's on a re-snapshot of the same commit), which is
    what the returned ``SkillSnapshot`` carries so usage events link to the real row.

    The repo SKILL.md remains canonical (§9.2): this only records provenance. ``new_snapshot_id``
    is injected (not ``uuid4`` inline) so the node stays pure and tests get deterministic ids.
    Snapshots are returned sorted by skill_path for a deterministic downstream prompt.
    """
    snapshots: list[SkillSnapshot] = []
    for raw in sorted(raw_skills, key=lambda s: s.skill_path):
        frontmatter, body = parse_frontmatter(raw.content)
        version = frontmatter.get("version")
        candidate = SkillSnapshot(
            snapshot_id=new_snapshot_id(),
            repo=repo,
            skill_name=_skill_name(frontmatter, raw.skill_path),
            skill_path=raw.skill_path,
            skill_version=version if isinstance(version, str) else None,
            commit_sha=raw.commit_sha,
            content_hash=_content_hash(raw.content),
            frontmatter=frontmatter,
            body_excerpt=body[:_BODY_EXCERPT_CHARS],
            is_active=True,
        )
        effective_id = sink.upsert_snapshot(candidate)
        snapshots.append(candidate.model_copy(update={"snapshot_id": effective_id}))
    return tuple(snapshots)


# --- T3 — load approved features --------------------------------------------------


def load_approved_features(
    release_run_id: str,
    reader: ApprovedFeatureReader,
) -> tuple[ApprovedFeature, ...]:
    """Load only Gate#1-approved features for the run (T3, PRD §5.3).

    Refuses to proceed when none are approved (AC: "with zero approved features the graph
    does not produce artifacts") by raising ``NoApprovedFeaturesError`` — the graph fails
    closed rather than generating from nothing. The reader already filters to
    ``status='approved'`` so rejected/edited features can never reach generation (§5).
    """
    features = reader.list_approved_features(release_run_id)
    if not features:
        raise NoApprovedFeaturesError()
    return features


# --- T4 — generate blog + changelog -----------------------------------------------

# (artifact_type, human label) — blog + changelog only this slice (PRD §8.1). All active
# skill snapshots feed every generation; the format/voice guidance lives in their bodies.
_ARTIFACT_TYPES: tuple[tuple[str, str], ...] = (
    ("release_blog", "release blog post"),
    ("changelog_entry", "product changelog entry"),
)

_GENERATE_SCHEMA: dict[str, object] = {
    "type": "object",
    "properties": {
        "title": {"type": "string"},
        "body_markdown": {"type": "string"},
    },
    "required": ["title", "body_markdown"],
}


def _render_features(features: tuple[ApprovedFeature, ...]) -> str:
    """Render approved features into the (redacted, approved-only) user prompt body.

    Deterministic ordering by feature_id so the idempotency hash is stable across retries.
    """
    blocks: list[str] = []
    for feature in sorted(features, key=lambda f: f.feature_id):
        lines = [f"[{feature.feature_id}] {feature.title}"]
        if feature.user_value:
            lines.append(f"User value: {feature.user_value}")
        if feature.summary_internal:
            lines.append(f"Summary: {feature.summary_internal}")
        if feature.audiences:
            lines.append(f"Audiences: {', '.join(feature.audiences)}")
        blocks.append("\n".join(lines))
    return "\n\n".join(blocks)


def _render_skills(snapshots: tuple[SkillSnapshot, ...]) -> str:
    """Render the loaded skill guidance into the system prompt, deterministically ordered.

    Only ``body_excerpt`` (repo-authored, non-PII) is injected — never evidence or PII."""
    blocks: list[str] = []
    for snap in sorted(snapshots, key=lambda s: s.skill_name):
        version = f" v{snap.skill_version}" if snap.skill_version else ""
        blocks.append(f"[{snap.skill_name}{version}]\n{snap.body_excerpt}")
    return "\n\n".join(blocks)


def _system_prompt(artifact_label: str, snapshots: tuple[SkillSnapshot, ...]) -> str:
    skills = _render_skills(snapshots)
    guidance = f"\n\n--- SKILL GUIDANCE ---\n{skills}" if skills else ""
    return (
        f"You write release content. Generate a {artifact_label} from the APPROVED "
        "release features supplied by the user. Use ONLY those features; never invent "
        "capabilities, metrics, percentages, customer names, or availability dates. "
        "Follow the brand voice and format guidance. Return strict JSON matching the "
        f"provided schema (a title and a Markdown body).{guidance}"
    )


def _idempotency_key(
    artifact_type: str,
    release_run_id: str,
    features: tuple[ApprovedFeature, ...],
    snapshots: tuple[SkillSnapshot, ...],
) -> str:
    """Deterministic dedupe key for one generation call (aws-bedrock-rules: Converse has no
    idempotency of its own). Same run + artifact type + approved-feature set + loaded skill
    versions → same key, so a retried job neither re-bills nor double-generates."""
    digest = hashlib.sha256()
    digest.update(artifact_type.encode("utf-8"))
    digest.update(b"\x00")
    digest.update(release_run_id.encode("utf-8"))
    for feature in sorted(features, key=lambda f: f.feature_id):
        digest.update(b"\x00f")
        digest.update(feature.feature_id.encode("utf-8"))
        digest.update(feature.title.encode("utf-8"))
        digest.update(feature.user_value.encode("utf-8"))
    for snap in sorted(snapshots, key=lambda s: s.skill_name):
        digest.update(b"\x00s")
        digest.update(snap.content_hash.encode("utf-8"))
    return digest.hexdigest()


def generate_artifacts(
    release_run_id: str,
    features: tuple[ApprovedFeature, ...],
    snapshots: tuple[SkillSnapshot, ...],
    model_client: ModelClient,
    new_artifact_id: Callable[[], str],
    model_id: str,
    prompt_version: str = PROMPT_VERSION,
) -> tuple[tuple[ArtifactDraft, ...], tuple[SkillUsageEvent, ...]]:
    """Generate the blog + changelog drafts via Bedrock Converse (T4, PRD §5.3/§8.1).

    The prompt carries only approved features (built from redacted evidence) and repo skill
    bodies — nothing raw (§5). Each response is validated through ``GeneratedArtifact``
    (untrusted model output, AC) and persisted-shape ``ArtifactDraft`` rows are minted
    ``status='draft'`` with the model/prompt/skill provenance (§18.3). For every loaded
    snapshot a ``skill_usage_events`` row is produced (AC: each artifact records which skill
    versions/hashes were loaded). Returns ``(artifacts, usage_events)`` for the persist node.
    """
    artifacts: list[ArtifactDraft] = []
    events: list[SkillUsageEvent] = []
    skill_versions = {s.skill_name: s.content_hash for s in snapshots}

    for artifact_type, label in _ARTIFACT_TYPES:
        messages = [{"role": "user", "content": _render_features(features)}]
        raw = model_client.generate_json(
            f"generate_{artifact_type}",
            _system_prompt(label, snapshots),
            messages,
            _GENERATE_SCHEMA,
            _idempotency_key(artifact_type, release_run_id, features, snapshots),
        )
        try:
            generated = GeneratedArtifact.model_validate(raw)
        except ValidationError as err:
            raise MalformedArtifactOutputError() from err

        artifact_id = new_artifact_id()
        artifacts.append(
            ArtifactDraft(
                artifact_id=artifact_id,
                release_run_id=release_run_id,
                feature_id=None,  # release-level: blog/changelog span all features
                artifact_type=artifact_type,
                title=generated.title,
                body_markdown=generated.body_markdown,
                status="draft",
                model_id=model_id,
                prompt_version=prompt_version,
                skill_versions=skill_versions,
            )
        )
        for snap in snapshots:
            events.append(
                SkillUsageEvent(
                    release_run_id=release_run_id,
                    artifact_id=artifact_id,
                    graph_name=_GRAPH_NAME,
                    node_name="generate_artifacts",
                    skill_snapshot_id=snap.snapshot_id,
                    skill_name=snap.skill_name,
                    skill_version=snap.skill_version,
                    content_hash=snap.content_hash,
                    usage_type="generation",
                )
            )
    return tuple(artifacts), tuple(events)


# --- T5 — persist reviewable artifacts --------------------------------------------


def persist_reviewable_artifacts(
    artifacts: tuple[ArtifactDraft, ...],
    events: tuple[SkillUsageEvent, ...],
    sink: ArtifactSink,
) -> tuple[str, ...]:
    """Persist the draft artifacts + their skill-usage events (T5, PRD §10.3/§10.5).

    Artifacts are inserted first because the usage events FK-reference the artifact row.
    Every artifact is ``status='draft'`` (no self-approval, §5). Returns the inserted
    artifact ids for the caller's audit/log.
    """
    inserted: list[str] = []
    for artifact in artifacts:
        sink.insert_artifact(artifact)
        inserted.append(artifact.artifact_id)
    for event in events:
        sink.record_skill_usage(event)
    return tuple(inserted)
