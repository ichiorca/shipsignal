"""Runtime ``SkillSource`` backed by the Aurora ``skills`` table — DB is the source of truth for
a skill's active body (constitution §2, as amended; peer-parity with hindsight-guild).

Generation grounds in the DB's CURRENT version: this reads ``skills.versions[current_version]
.body_md`` for each active skill, **reconciles** the derived repo ``skills/<name>/SKILL.md`` cache
(atomic write so a concurrent reader never sees a partial file), and returns ``RawSkill`` for the
existing snapshot/generation path. If the DB is unreachable or has no skills, it falls back to the
on-disk ``FilesystemSkillSource`` so a transient DB hiccup never blanks generation (mirrors the
peer's ``read_body`` disk fallback). Imported only by ``__main__`` at runtime (psycopg), so the
unit gate never imports it — generation is tested against the in-memory ``StaticSkillSource``.
"""

from __future__ import annotations

import contextlib
import logging
import os
import tempfile
from pathlib import Path

import psycopg

from release_worker.content_models import RawSkill
from release_worker.content_ports import SkillSource

logger = logging.getLogger("release_worker.skills")


class AuroraSkillSource:
    """``SkillSource`` that serves the active skill bodies from the Aurora ``skills`` table and
    reconciles the repo file cache. ``fallback`` (the on-disk source) is used when the DB read
    fails or returns nothing."""

    def __init__(
        self,
        conn: psycopg.Connection,
        skills_root: Path,
        fallback: SkillSource | None = None,
    ) -> None:
        self._conn = conn
        self._skills_root = skills_root
        self._fallback = fallback

    @classmethod
    def from_env(
        cls, conn: psycopg.Connection, fallback: SkillSource | None = None
    ) -> AuroraSkillSource:
        return cls(conn, Path(os.environ.get("SKILLS_ROOT", "skills")), fallback)

    def list_skills(self) -> tuple[RawSkill, ...]:
        try:
            with self._conn.cursor() as cur:
                cur.execute(
                    "SELECT name, current_version, versions FROM skills "
                    "WHERE status = 'active' AND skill_kind = 'agent_skill'"
                )
                rows = cur.fetchall()
        except psycopg.Error as err:
            logger.warning(
                "skills table unreadable (%s); using on-disk fallback",
                type(err).__name__,
            )
            return self._fallback.list_skills() if self._fallback else ()

        raws: list[RawSkill] = []
        for name, current_version, versions in rows:
            entry = (versions or {}).get(current_version) or {}
            body_md = entry.get("body_md")
            if not isinstance(body_md, str) or not body_md:
                continue  # no body for the current version → skip (fail closed for this skill)
            self._reconcile_file(name, body_md)
            # skill_path is the repo-relative cache path; commit_sha carries the DB version as the
            # active provenance marker (the content hash is the tamper-evident key downstream).
            raws.append(
                RawSkill(
                    skill_path=f"skills/{name}/SKILL.md",
                    content=body_md,
                    commit_sha=str(current_version),
                )
            )

        if not raws:
            return self._fallback.list_skills() if self._fallback else ()
        return tuple(raws)

    def _reconcile_file(self, name: str, body_md: str) -> None:
        """Rewrite ``skills/<name>/SKILL.md`` from the DB body when it differs (atomic temp+replace
        so a concurrent reader never sees a partial write). Best-effort: a filesystem error logs
        and is swallowed — the DB body is still what generation uses this run."""
        target = self._skills_root / name / "SKILL.md"
        with contextlib.suppress(OSError):
            if target.is_file() and target.read_text(encoding="utf-8") == body_md:
                return
        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            fd, tmp_path = tempfile.mkstemp(
                dir=str(target.parent), prefix=".SKILL.md.", suffix=".tmp"
            )
            try:
                with os.fdopen(fd, "w", encoding="utf-8") as fh:
                    fh.write(body_md)
                os.replace(tmp_path, str(target))
            except OSError:
                with contextlib.suppress(OSError):
                    os.unlink(tmp_path)
                raise
        except OSError as err:
            logger.warning("could not reconcile skill %s to disk: %s", name, err)
