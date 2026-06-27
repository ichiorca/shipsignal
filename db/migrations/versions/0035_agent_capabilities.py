"""agent_capabilities: persisted agent→capability (artifact_type) allowlist (DB-overridable)

Sibling of ``capability_skills`` (migration 0032) one level up the chain. Where 0032 maps a
*capability* (artifact type) to the *skills* that ground it, this maps an *agent* (a LangGraph
pipeline stage) to the *capabilities* (artifact types) it is allowed to produce — peer-parity with
hindsight-guild-internal's per-agent allowlist (``SKILLS_BY_AGENT`` is the skill side; this is the
capability side). The chain the Skill-library views render is now: agent → capability → skill.

ShipSignal's only stage that produces artifact-type capabilities is **content-generation**
(``content_graph`` / ``content_nodes._ARTIFACT_SPECS``); the other stages (release-intelligence,
eval, media-generation, skill-learning) emit pipeline outputs — evidence, scores, the demo video,
skill candidates — not artifact types, so they have no rows here. The code default is
``content_nodes.code_default_agent_capabilities()`` (content-generation → every artifact type).

Semantics (see ``aurora_agent_capabilities.AuroraAgentCapabilitySource``), identical to 0032 one
key over:
  * One row per (agent_id, artifact_type). ``source`` distinguishes a seeded code default from an
    operator override.
  * Resolution is DB-wins-per-agent: if the table has ANY row for an agent, that set is
    authoritative for that agent; an agent absent from the table falls back to its code default.
    A DB read error falls back wholesale to the code default — generation never fails closed on a
    DB hiccup, and an operator can never strand the content stage with zero capabilities (removing
    the last row reverts it to the code-default set).

Tenancy: kept global / agent-keyed, matching the sibling ``capability_skills`` (0032) and the
single-org agent registry; project/tenant scoping (cf. 0030) would extend the key to
(tenant_id, agent_id, artifact_type) then.

Real DDL — not a stub; the downgrade is a clean inverse.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0035_agent_capabilities"
down_revision: str | None = "0034_llm_response_cache"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE agent_capabilities (
            agent_id      TEXT NOT NULL,
            artifact_type TEXT NOT NULL,
            source        TEXT NOT NULL DEFAULT 'code-default'
                            CHECK (source IN ('code-default', 'operator-override')),
            created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
            PRIMARY KEY (agent_id, artifact_type)
        );
        """
    )
    op.execute(
        "CREATE INDEX ix_agent_capabilities_agent ON agent_capabilities (agent_id);"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS agent_capabilities;")
