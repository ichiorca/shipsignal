"""gate_notifications — idempotent reviewer-notification ledger

Revision ID: 0020_gate_notifications
Revises: 0019_outbound_webhook_deliveries
Create Date: 2026-06-09

T1 (spec 020) — when a gate interrupt (Gate #1/#2/#3) or a run failure triggers a Slack
notification, the dispatch must be idempotent per (release_run_id, gate): a resumed or
replayed graph re-raises the same interrupt, and the worker must not re-ping the channel.
One row per (run, gate): the UNIQUE key is what the dispatcher checks before sending, and
redelivery after a transient HTTP failure reuses the row (attempt_count + last_status +
last_error trace the retry trail for the audit).

``notified_at`` doubles as the spec's latency-attribution anchor (T5): NULL means the
notification was attempted but never delivered; a timestamp marks the moment a human was
told the gate opened, so approval latency can be split into "time to notice" vs "time to
decide" on the evals screen.

P5 (Safety rails): the ledger stores dispatch METADATA only — gate name, attempt count,
HTTP status, a secret-free error label, timestamps. Never the message payload (it is
metadata-only by construction, but duplicating it here would still widen the surface) and
never the webhook URL (a Slack incoming-webhook URL embeds a credential).

P4 (Storage) / constitution §2: every row carries ``release_run_id`` (the tenancy key) and
CASCADE-deletes with its run, so GDPR erasure of a run also erases its notification trail.

Real DDL — not a stub (anti-pattern #1); the downgrade is a clean inverse.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0020_gate_notifications"
down_revision: str | None = "0019_outbound_webhook_deliveries"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # One notification per (run, gate). gate is the §5.6 interrupt gate name
    # ('feature_manifest_approval' / 'artifact_review' / 'skill_candidate_approval') or
    # 'run_failed' for the failure path. notified_at NULL = not (yet) delivered.
    op.execute(
        """
        CREATE TABLE gate_notifications (
            id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            release_run_id UUID NOT NULL
                             REFERENCES release_runs(id) ON DELETE CASCADE,
            gate           TEXT NOT NULL,
            attempt_count  INTEGER NOT NULL DEFAULT 0,
            last_status    INTEGER,
            last_error     TEXT,
            notified_at    TIMESTAMPTZ,
            created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
            UNIQUE (release_run_id, gate)
        );
        """
    )
    # The evals read path ("which gates were notified, when?") reads by run.
    op.execute(
        "CREATE INDEX ix_gate_notifications_release_run_id "
        "ON gate_notifications (release_run_id);"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_gate_notifications_release_run_id;")
    op.execute("DROP TABLE IF EXISTS gate_notifications;")
