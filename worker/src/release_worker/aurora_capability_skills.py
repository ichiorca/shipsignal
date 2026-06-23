"""Runtime ``CapabilitySkillSource`` backed by the Aurora ``capability_skills`` table.

Resolves the per-capability (artifact_type) skill selection that grounds generation. Peer-parity
with hindsight-guild-internal's ``allowed_for`` (per-agent allowlist + ``agent_skill_overrides``
merge): the code default (``content_nodes.code_default_capability_skills`` — each type's format
skill + brand-voice) is the floor, and a persisted operator override in ``capability_skills`` WINS
per type. A type with no rows falls back to its code default; a DB read error falls back wholesale
to the code default — grounding never fails closed on a DB hiccup (mirrors the peer's fail-safe to
the static config). Imported only by ``__main__`` at runtime (psycopg), so the unit gate never
imports it — generation is tested against ``InMemoryCapabilitySkillSource``.
"""

from __future__ import annotations

import logging

import psycopg

logger = logging.getLogger("release_worker.skills")


class AuroraCapabilitySkillSource:
    """``CapabilitySkillSource`` that resolves the capability→skill map from ``capability_skills``,
    falling back to the injected code default per unmapped type and on any DB read error."""

    def __init__(
        self,
        conn: psycopg.Connection,
        code_default: dict[str, frozenset[str]],
    ) -> None:
        self._conn = conn
        self._code_default = code_default

    @classmethod
    def from_env(
        cls, conn: psycopg.Connection, code_default: dict[str, frozenset[str]]
    ) -> AuroraCapabilitySkillSource:
        return cls(conn, code_default)

    def resolve(self) -> dict[str, frozenset[str]]:
        try:
            with self._conn.cursor() as cur:
                cur.execute("SELECT artifact_type, skill_name FROM capability_skills")
                rows = cur.fetchall()
        except psycopg.Error as err:
            logger.warning(
                "capability_skills unreadable (%s); using code-default capability map",
                type(err).__name__,
            )
            return dict(self._code_default)

        # DB-wins-per-type: any row for a type makes the DB set authoritative for that type.
        db_map: dict[str, set[str]] = {}
        for artifact_type, skill_name in rows:
            if isinstance(artifact_type, str) and isinstance(skill_name, str):
                db_map.setdefault(artifact_type, set()).add(skill_name)

        resolved: dict[str, frozenset[str]] = {
            artifact_type: frozenset(skills) for artifact_type, skills in db_map.items()
        }
        # Types absent from the table fall back to the code default (the floor).
        for artifact_type, skills in self._code_default.items():
            resolved.setdefault(artifact_type, skills)
        return resolved
