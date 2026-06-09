"""outbound_webhook_deliveries — audited, idempotent distribution ledger

Revision ID: 0019_outbound_webhook_deliveries
Revises: 0018_skill_status_check_and_vector_index
Create Date: 2026-06-09

T3 (spec 019) — when a Gate #2 approval fires the outbound distribution webhook, every delivery
must be audited and idempotent (the spec's AC mirrors the inbound `webhook_deliveries` posture:
at-least-once consumers need a stable delivery id to dedupe on, and redelivery after a transient
failure must reuse it). One row per (artifact, event): ``delivery_id`` is computed
deterministically by the app and ``UNIQUE``, so a replayed dispatch (route retry, run-level
sweep after per-artifact dispatch) lands ON CONFLICT DO NOTHING instead of double-sending.

P5 (Safety rails): the ledger stores delivery METADATA only — target URL, attempt count, last
HTTP status, a secret-free error string, timestamps. Never the payload body (the §18.1 content
is already in approved_artifact_snapshots; duplicating it here would just widen the PII/secret
blast surface) and never the signing secret.

P4 (Storage) / constitution §2: every row carries ``release_run_id`` (the tenancy key) and
CASCADE-deletes with its run/artifact, so GDPR erasure of a run also erases its delivery trail.

Real DDL — not a stub (anti-pattern #1); the downgrade is a clean inverse.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0019_outbound_webhook_deliveries"
down_revision: str | None = "0018_skill_status_check_and_vector_index"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # One delivery per (artifact, event). delivered_at NULL = not yet (or never) delivered;
    # attempt_count/last_status/last_error trace the most recent dispatch outcome for the audit.
    op.execute(
        """
        CREATE TABLE outbound_webhook_deliveries (
            id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            delivery_id    TEXT NOT NULL UNIQUE,
            release_run_id UUID NOT NULL
                             REFERENCES release_runs(id) ON DELETE CASCADE,
            artifact_id    UUID NOT NULL
                             REFERENCES artifacts(id) ON DELETE CASCADE,
            event_type     TEXT NOT NULL,
            target_url     TEXT NOT NULL,
            attempt_count  INTEGER NOT NULL DEFAULT 0,
            last_status    INTEGER,
            last_error     TEXT,
            delivered_at   TIMESTAMPTZ,
            created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
            UNIQUE (artifact_id, event_type)
        );
        """
    )
    # The run-level sweep ("which approved artifacts still need delivery?") reads by run.
    op.execute(
        "CREATE INDEX ix_outbound_webhook_deliveries_release_run_id "
        "ON outbound_webhook_deliveries (release_run_id);"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_outbound_webhook_deliveries_release_run_id;")
    op.execute("DROP TABLE IF EXISTS outbound_webhook_deliveries;")
