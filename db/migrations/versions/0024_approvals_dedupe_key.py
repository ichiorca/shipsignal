"""approvals.dedupe_key — idempotency guard for one-shot dispatch decisions

Revision ID: 0024_approvals_dedupe_key
Revises: 0023_artifact_types_customer_email_battlecard
Create Date: 2026-06-14

Staff-review finding (concurrency/idempotency): every state-changing gate route records an
approvals row with an UNCONDITIONAL insert and then fires a one-shot side effect (worker
resume dispatch, media `workflow_dispatch`, GitHub Release / Slack publish). A double-click or
network retry wrote a SECOND audit row and fired a SECOND dispatch — two worker dispatches /
two Slack messages / two media Action runs for one human action.

The `approvals` table is the gate-agnostic immutable decision log (§10.4). For per-card
decisions (`feature`, `artifact`) MULTIPLE rows are intentional (a card is freely re-decidable
before its manifest gate), so a blanket UNIQUE on (target_type, target_id) would be wrong.
Instead we add a NULLABLE `dedupe_key` used ONLY by the one-shot routes, with a PARTIAL UNIQUE
index over the non-null keys. Per-card rows leave it NULL and keep their append-only semantics.

Dedupe key shapes used by the app layer (see app/lib/db/approvals.ts callers):
  - feature_manifest:<release_run_id>            (Gate #1 run-level resume)
  - artifact_manifest:<release_run_id>           (Gate #2 run-level resume)
  - skill_candidate_manifest:<release_run_id>    (Gate #3 run-level resume)
  - skill_candidate:<candidate_id>               (Gate #3 per-candidate decision)
  - media_trigger:<feature_id>                   (demo media generation trigger)
  - artifact_publish:<artifact_id>:github_release
  - artifact_publish:<artifact_id>:slack         (publish is per-destination, not per-artifact)

Real DDL — additive and backward compatible: existing rows get NULL (excluded from the partial
index), so no data rewrite and no conflict with historical duplicates.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0024_approvals_dedupe_key"
down_revision: str | None = "0023_artifact_types_customer_email_battlecard"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("ALTER TABLE approvals ADD COLUMN IF NOT EXISTS dedupe_key TEXT;")
    # Partial unique index: enforce one row per dedupe_key, but only over the rows that set it.
    # NULL keys (per-card feature/artifact decisions) stay append-only and are not constrained.
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS ux_approvals_dedupe "
        "ON approvals (dedupe_key) WHERE dedupe_key IS NOT NULL;"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ux_approvals_dedupe;")
    op.execute("ALTER TABLE approvals DROP COLUMN IF EXISTS dedupe_key;")
