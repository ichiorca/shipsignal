"""scheduled_publishes — approve-then-schedule queue

Revision ID: 0027_scheduled_publishes
Revises: 0026_artifact_types_x_hackernews
Create Date: 2026-06-15

Path B / Phase 4 (Gate-0 D1/D3/D4 approved 2026-06-15): the "ship when your audience is awake"
queue. A human approves an artifact at Gate #2 (unchanged), then optionally schedules its publish
for a later time; a GitHub Actions cron drains due+approved rows and invokes the Phase-3 publish
adapters. Scheduling defers only the EXECUTION of an already-approved artifact — it is not
autopublishing (the ratified §2/§5 reading).

P5 (Safety rails): metadata only — the channel, the time, the status, the secret-free last error,
and the approval_id that authorized it (so every scheduled send is traceable to its Gate #2
approval). No payload body, no token. P4 / §2: every row carries release_run_id (tenancy key) and
CASCADE-deletes with its run/artifact, so GDPR erasure of a run also erases its schedule.

Real DDL — not a stub (anti-pattern #1); the downgrade is a clean inverse.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0027_scheduled_publishes"
down_revision: str | None = "0026_artifact_types_x_hackernews"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE scheduled_publishes (
            id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            artifact_id    UUID NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
            release_run_id UUID NOT NULL REFERENCES release_runs(id) ON DELETE CASCADE,
            channel        TEXT NOT NULL CHECK (channel IN ('linkedin', 'x')),
            scheduled_at   TIMESTAMPTZ NOT NULL,
            status         TEXT NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending', 'sent', 'failed', 'cancelled')),
            approval_id    UUID,
            attempt_count  INTEGER NOT NULL DEFAULT 0,
            last_error     TEXT,
            published_url  TEXT,
            created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
            -- One live schedule per (artifact, channel): a re-schedule replaces, never stacks.
            UNIQUE (artifact_id, channel)
        );
        """
    )
    # The cron drain reads "due AND pending", ordered by time — index the hot path.
    op.execute(
        "CREATE INDEX ix_scheduled_publishes_due "
        "ON scheduled_publishes (status, scheduled_at);"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_scheduled_publishes_due;")
    op.execute("DROP TABLE IF EXISTS scheduled_publishes;")
