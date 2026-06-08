"""skill_revision_candidates.promotion_mode + promotion_pr_url — §15.3 promotion provenance

Revision ID: 0017_skill_promotion_mode
Revises: 0016_approved_artifact_snapshots
Create Date: 2026-06-08

T3 (spec 018) — the skill promotion flow gains a config-selectable mode (PRD §9.4.4 / §15.3): the
preferred production PR flow (branch → replace SKILL.md → open PR) or the hackathon-fast direct
write to the checked-out tree. The ledger must record HOW a skill was promoted, so add two columns
to ``skill_revision_candidates``:

* ``promotion_mode`` — 'direct' | 'pr', the mode that landed the replacement;
* ``promotion_pr_url`` — the opened pull request url for the PR mode (NULL for direct).

These join the existing promotion provenance (``promoted_commit_sha`` + old/new content hashes +
reviewer) that is PRESERVED after the repo file is replaced (§9.4.5 / AC2). Both columns are
nullable: they are populated only on an APPROVED Gate #3 promotion (constitution §5 — a draft /
rejected candidate has no promotion mode), so existing rows and every non-promoted row stay NULL.

Real DDL — not a stub (anti-pattern #1); the downgrade drops the columns (a clean inverse).
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0017_skill_promotion_mode"
down_revision: str | None = "0016_approved_artifact_snapshots"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Mode + PR url are written only on an approved promotion (AuroraSkillCandidateSink.mark_promoted),
    # so both are nullable and existing/non-promoted rows remain NULL (no backfill needed).
    op.execute("ALTER TABLE skill_revision_candidates ADD COLUMN promotion_mode TEXT;")
    op.execute(
        "ALTER TABLE skill_revision_candidates ADD COLUMN promotion_pr_url TEXT;"
    )


def downgrade() -> None:
    op.execute(
        "ALTER TABLE skill_revision_candidates DROP COLUMN IF EXISTS promotion_pr_url;"
    )
    op.execute(
        "ALTER TABLE skill_revision_candidates DROP COLUMN IF EXISTS promotion_mode;"
    )
