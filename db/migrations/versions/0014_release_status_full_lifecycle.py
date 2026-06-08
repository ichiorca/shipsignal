"""release_runs.status full PRD §13.2 lifecycle

Revision ID: 0014_release_status_full_lifecycle
Revises: 0013_media_assets_reconcile
Create Date: 2026-06-08

T1 (spec 015) — widen release_runs.status from the spec-001 4-state skeleton
(queued/running/completed/failed) to the full PRD §13.2 12-state release lifecycle, and
migrate any in-flight rows onto the new lattice. The application (TS app/lib/runStatus.ts
and the worker release_worker/status.py) advances a run one step at a time through these
states; the CHECK constraint is the DB-side floor that rejects an out-of-lattice write
even if an application bug tries one (mirrors migration 0001's intent).

Data migration (real DML — not a stub, anti-pattern #1):
  * 'queued'  -> 'created'              (the new initial state; the row was just inserted)
  * 'running' -> 'collecting_evidence'  (the first active state a started run is in)
  'completed'/'failed' are unchanged — they exist verbatim in the new lattice.

The column DEFAULT also moves to 'created' so a future direct insert lands on the new
initial state. P4 (Storage) / constitution §2: the row stays keyed by its own id (the
release_run_id tenancy key); only the status domain changes. The downgrade narrows back
to the 4-state skeleton, remapping the new states onto their nearest skeleton equivalent
so the inverse is clean.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0014_release_status_full_lifecycle"
down_revision: str | None = "0013_media_assets_reconcile"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# The full PRD §13.2 lifecycle, in canonical progress order then the off-path terminals.
_FULL_STATUSES: tuple[str, ...] = (
    "created",
    "collecting_evidence",
    "evidence_ready",
    "features_pending_review",
    "features_approved",
    "generating_artifacts",
    "artifacts_pending_review",
    "artifacts_approved",
    "generating_media",
    "completed",
    "failed",
    "cancelled",
)

_SKELETON_STATUSES: tuple[str, ...] = ("queued", "running", "completed", "failed")


def _check_list(statuses: tuple[str, ...]) -> str:
    return ", ".join(f"'{s}'" for s in statuses)


def upgrade() -> None:
    # Drop the old CHECK first so the data remap can write the new values, then re-add the
    # widened CHECK + move the DEFAULT. The constraint name is the Postgres default for an
    # inline column CHECK on (table, column): release_runs_status_check.
    op.execute(
        "ALTER TABLE release_runs DROP CONSTRAINT IF EXISTS release_runs_status_check;"
    )

    # Remap in-flight rows onto the new lattice (real DML).
    op.execute("UPDATE release_runs SET status = 'created' WHERE status = 'queued';")
    op.execute(
        "UPDATE release_runs SET status = 'collecting_evidence' WHERE status = 'running';"
    )

    op.execute("ALTER TABLE release_runs ALTER COLUMN status SET DEFAULT 'created';")
    op.execute(
        "ALTER TABLE release_runs ADD CONSTRAINT release_runs_status_check "
        f"CHECK (status IN ({_check_list(_FULL_STATUSES)}));"
    )


def downgrade() -> None:
    op.execute(
        "ALTER TABLE release_runs DROP CONSTRAINT IF EXISTS release_runs_status_check;"
    )

    # Collapse the 12-state lifecycle back onto the 4-state skeleton: 'created' -> 'queued',
    # every active/pending state -> 'running', terminals map to themselves ('cancelled' has
    # no skeleton equivalent, so it folds into the terminal 'failed').
    op.execute("UPDATE release_runs SET status = 'queued' WHERE status = 'created';")
    op.execute("UPDATE release_runs SET status = 'failed' WHERE status = 'cancelled';")
    op.execute(
        """
        UPDATE release_runs SET status = 'running'
         WHERE status IN (
            'collecting_evidence', 'evidence_ready', 'features_pending_review',
            'features_approved', 'generating_artifacts', 'artifacts_pending_review',
            'artifacts_approved', 'generating_media'
         );
        """
    )

    op.execute("ALTER TABLE release_runs ALTER COLUMN status SET DEFAULT 'queued';")
    op.execute(
        "ALTER TABLE release_runs ADD CONSTRAINT release_runs_status_check "
        f"CHECK (status IN ({_check_list(_SKELETON_STATUSES)}));"
    )
