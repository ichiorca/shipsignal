"""capability_skills: persisted capability→skill mapping (peer-parity, DB-overridable)

Mirrors the peer (hindsight-guild-internal ``agents/_skills_config.py``) where each *agent* has a
code-default skill allowlist (``SKILLS_BY_AGENT`` / ``REQUIRED_SKILLS_BY_AGENT``) that a persisted
override (``agent_skill_overrides``) MERGES over — DB wins, code is the fail-safe floor.

ShipSignal's "capability" is the **artifact type** (release_blog, changelog_entry, …): the unit the
content graph produces. The code default is ``content_nodes._ARTIFACT_SPECS`` — each type grounds in
``{its format skill, brand-voice}``. That selection lived only in code (``_skills_for_spec``); the
only thing persisted was *runtime usage* (``skill_usage_events``). This table persists the
*selection mapping itself* so it is (a) visible on the Capabilities page and (b) operator-overridable
without a code change — exactly the peer's pattern, so a future merge is a join not a rewrite.

Semantics (see ``aurora_capability_skills.AuroraCapabilitySkillSource``):
  * One row per (artifact_type, skill_name). ``required`` marks a must-load skill; ``source``
    distinguishes a seeded code default from an operator override.
  * Resolution is DB-wins-per-type: if the table has ANY row for a type, that set is authoritative
    for the type; a type absent from the table falls back to the code default. A DB read error
    falls back wholesale to the code default — grounding never fails closed on a DB hiccup.

Tenancy: kept global / type-keyed for parity with the peer's single-org agent registry and with the
sibling ``skills`` table (migration 0031); project/tenant scoping (cf. 0030) would extend the key to
(tenant_id, artifact_type, skill_name) then.

Real DDL — not a stub; the downgrade is a clean inverse.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0032_capability_skill_map"
down_revision: str | None = "0031_skills_versioned_store"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE capability_skills (
            artifact_type TEXT NOT NULL,
            skill_name    TEXT NOT NULL,
            required      BOOLEAN NOT NULL DEFAULT TRUE,
            source        TEXT NOT NULL DEFAULT 'code-default'
                            CHECK (source IN ('code-default', 'operator-override')),
            created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
            PRIMARY KEY (artifact_type, skill_name)
        );
        """
    )
    op.execute(
        "CREATE INDEX ix_capability_skills_type ON capability_skills (artifact_type);"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS capability_skills;")
