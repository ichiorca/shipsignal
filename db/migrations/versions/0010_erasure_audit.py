"""erasure_audit table

Revision ID: 0010_erasure_audit
Revises: 0009_evidence_retention_metadata
Create Date: 2026-06-08

T2 (spec 010) — the audit trail for data-subject erasures (GDPR Art.17 + accountability,
Art.5(2)). One row records each erasure of a run's personal data across Aurora + S3: who
requested it, why, how many Aurora rows + S3 objects were removed, and when.

Constitution §7: a data-subject-rights request is an escalation trigger, never a silent
operation — so the request is *recorded*, with the requester and reason mandatory
(``erasure.erase_release_run`` requires them before it acts).

This table deliberately does NOT carry a FK to ``release_runs``: the whole point of an
erasure is that the ``release_runs`` row (and its CASCADE children) is gone afterwards, so a
FK would either block the delete or CASCADE the audit away with it. ``release_run_id`` is a
bare UUID column — the durable proof that the run *was* erased outlives the run. It holds no
personal data (only the run id + operational metadata), so it is itself retention-safe.

Real DDL — not a stub (anti-pattern #1); the downgrade is a clean inverse.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0010_erasure_audit"
down_revision: str | None = "0009_evidence_retention_metadata"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # No FK to release_runs (see module docstring): the audit must SURVIVE the run's deletion.
    # rows_deleted/objects_deleted are the verified counts the erasure recorded after sweeping
    # Aurora (CASCADE) and the S3 evidence/<run>/ + media/<run>/ prefixes.
    op.execute(
        """
        CREATE TABLE erasure_audit (
            id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            release_run_id   UUID NOT NULL,
            requested_by     TEXT NOT NULL,
            reason           TEXT NOT NULL,
            rows_deleted     INTEGER NOT NULL,
            objects_deleted  INTEGER NOT NULL,
            erased_at        TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        """
    )
    # "Has this run been erased / when?" is the audit read; index the run id.
    op.execute(
        "CREATE INDEX ix_erasure_audit_release_run_id "
        "ON erasure_audit (release_run_id);"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_erasure_audit_release_run_id;")
    op.execute("DROP TABLE IF EXISTS erasure_audit;")
