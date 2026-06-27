"""Runtime ``AgentCapabilitySource`` backed by the Aurora ``agent_capabilities`` table.

Resolves the per-agent (pipeline stage) capability allowlist — which artifact types each agent is
allowed to produce. Sibling of ``AuroraCapabilitySkillSource`` one level up the chain
(agent → capability → skill): the code default (``content_nodes.code_default_agent_capabilities`` —
content-generation → every artifact type) is the floor, and a persisted operator override in
``agent_capabilities`` WINS per agent. An agent with no rows falls back to its code default; a DB
read error falls back wholesale to the code default — generation never fails closed on a DB hiccup,
and the content stage can never be stranded with zero capabilities. Imported only by ``__main__`` at
runtime (psycopg), so the unit gate never imports it — generation is tested against
``InMemoryAgentCapabilitySource``.
"""

from __future__ import annotations

import logging

import psycopg

logger = logging.getLogger("release_worker.skills")


class AuroraAgentCapabilitySource:
    """``AgentCapabilitySource`` that resolves the agent→capability map from ``agent_capabilities``,
    falling back to the injected code default per unmapped agent and on any DB read error."""

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
    ) -> AuroraAgentCapabilitySource:
        return cls(conn, code_default)

    def resolve(self) -> dict[str, frozenset[str]]:
        try:
            with self._conn.cursor() as cur:
                cur.execute("SELECT agent_id, artifact_type FROM agent_capabilities")
                rows = cur.fetchall()
        except psycopg.Error as err:
            logger.warning(
                "agent_capabilities unreadable (%s); using code-default agent map",
                type(err).__name__,
            )
            return dict(self._code_default)

        # DB-wins-per-agent: any row for an agent makes the DB set authoritative for that agent.
        db_map: dict[str, set[str]] = {}
        for agent_id, artifact_type in rows:
            if isinstance(agent_id, str) and isinstance(artifact_type, str):
                db_map.setdefault(agent_id, set()).add(artifact_type)

        resolved: dict[str, frozenset[str]] = {
            agent_id: frozenset(types) for agent_id, types in db_map.items()
        }
        # Agents absent from the table fall back to the code default (the floor).
        for agent_id, types in self._code_default.items():
            resolved.setdefault(agent_id, types)
        return resolved
