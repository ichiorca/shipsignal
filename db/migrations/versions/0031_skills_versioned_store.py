"""skills: DB-backed versioned skill store (peer-parity skill evolution, Phase 1 — additive)

Mirrors the peer (hindsight-guild) ``skills`` model so a future merge is a join, not a rewrite:
one row per skill carrying ``current_version`` + a ``versions{}`` map of
``{ "<version>": { body_md, content_hash, frontmatter, source, created_at } }``.

This migration is the ADDITIVE foundation only. The repo ``skills/**/SKILL.md`` files remain the
source of truth (constitution §2) and the worker is unchanged — nothing reads this table for
generation yet. The eventual source-of-truth FLIP (the worker serving
``versions[current_version].body_md`` and reconciling the file; Gate #3 promotion writing a new
version here) is a separate change, gated on an explicit constitution §2/§5 amendment (operator
approval — `memory/constitution.md` is a protected path).

Tenancy: kept global / name-keyed for parity with the peer's single-org skill registry; if skills
later need project/tenant scoping (cf. migration 0030) the key becomes (tenant_id, name) then.

Real DDL — not a stub; the downgrade is a clean inverse.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0031_skills_versioned_store"
down_revision: str | None = "0030_projects_and_tenants"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE skills (
            name            TEXT PRIMARY KEY,
            skill_kind      TEXT NOT NULL DEFAULT 'agent_skill'
                              CHECK (skill_kind IN ('agent_skill', 'playbook')),
            status          TEXT NOT NULL DEFAULT 'active'
                              CHECK (status IN ('active', 'archived')),
            current_version TEXT NOT NULL,
            versions        JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        """
    )
    op.execute("CREATE INDEX ix_skills_status ON skills (status);")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS skills;")
