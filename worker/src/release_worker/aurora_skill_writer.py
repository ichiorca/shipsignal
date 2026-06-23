"""Runtime ``RepoSkillWriter`` that makes the Aurora ``skills`` table the source of truth on Gate
#3 promotion (constitution §5, as amended), then delegates to the configured inner writer to
reconcile the derived file (direct mode) or open a PR (pr mode).

The flip: on an approved promotion the system writes a NEW version to ``skills`` (append
``versions[<v>]`` + bump ``current_version``) — the DB is now authoritative — and only then does
the inner writer reconcile the ``skills/**/SKILL.md`` cache. The new version is read from the
promoted content's own frontmatter (the candidate body carries its bumped ``version``); absent
that, a content-derived marker keeps the write deterministic. Imported only by ``__main__`` at
runtime (psycopg), so the unit gate tests the graph against ``InMemoryRepoSkillWriter``.
"""

from __future__ import annotations

import hashlib
import json
import logging
from pathlib import Path

import psycopg

from release_worker.content_nodes import parse_frontmatter
from release_worker.skill_learning_models import PromotionResult
from release_worker.skill_learning_ports import RepoSkillWriter

logger = logging.getLogger("release_worker.skills")

# Append the promoted version into versions{} and point current_version at it (DB-as-SoT). Merging
# (||) preserves prior versions, so the row keeps its full evolution history.
_PROMOTE_SQL = """
    INSERT INTO skills (name, skill_kind, status, current_version, versions)
    VALUES (%s, 'agent_skill', 'active', %s,
            jsonb_build_object(%s::text, jsonb_build_object(
                'body_md', %s::text,
                'content_hash', %s::text,
                'frontmatter', %s::jsonb,
                'source', 'gate3-promotion'
            )))
    ON CONFLICT (name) DO UPDATE
        SET versions = skills.versions || EXCLUDED.versions,
            current_version = EXCLUDED.current_version,
            status = 'active',
            updated_at = now()
"""


class DbBackedRepoSkillWriter:
    """``RepoSkillWriter`` decorator: write the approved version to ``skills`` (SoT), then delegate
    to ``inner`` (direct file write or PR) to reconcile the cache. Returns the inner writer's
    ``PromotionResult`` so the recorded ``commit_sha``/``new_content_hash`` provenance is unchanged."""

    def __init__(self, conn: psycopg.Connection, inner: RepoSkillWriter) -> None:
        self._conn = conn
        self._inner = inner

    def replace_skill_file(self, skill_path: str, file_content: str) -> PromotionResult:
        name = Path(skill_path).parent.name
        frontmatter, _ = parse_frontmatter(file_content)
        raw_version = frontmatter.get("version")
        content_hash = hashlib.sha256(file_content.encode("utf-8")).hexdigest()
        # The promoted body should carry its bumped version; if it doesn't, derive a stable marker
        # from the content hash so the DB write is still deterministic and never collides silently.
        version = (
            raw_version
            if isinstance(raw_version, str) and raw_version
            else f"sha-{content_hash[:12]}"
        )

        with self._conn.transaction(), self._conn.cursor() as cur:
            cur.execute(
                _PROMOTE_SQL,
                (
                    name,
                    version,
                    version,
                    file_content,
                    content_hash,
                    json.dumps(frontmatter),
                ),
            )
        logger.info(
            "promoted skill %s to version %s in the skills table", name, version
        )

        # Reconcile the derived cache (file overwrite for direct mode; PR for pr mode).
        return self._inner.replace_skill_file(skill_path, file_content)
