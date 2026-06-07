"""release_runs table

Revision ID: 0001_release_runs
Revises:
Create Date: 2026-06-07

T2 (spec 001) — the release_runs table per PRD §10.1. Every downstream record is
scoped to a release_runs.id (the release_run_id tenancy key, P4 / constitution §2).
Status and trigger_type carry CHECK constraints so the DB rejects out-of-lattice
values even if an application bug tries to write one. Real DDL — not a stub
(anti-pattern #1).
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0001_release_runs"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE release_runs (
            id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            repo                TEXT NOT NULL,
            base_ref            TEXT NOT NULL,
            head_ref            TEXT NOT NULL,
            trigger_type        TEXT NOT NULL
                                  CHECK (trigger_type IN
                                    ('manual', 'release_tag', 'workflow_dispatch')),
            status              TEXT NOT NULL DEFAULT 'queued'
                                  CHECK (status IN
                                    ('queued', 'running', 'completed', 'failed')),
            langgraph_thread_id TEXT,
            run_metadata_json   JSONB NOT NULL DEFAULT '{}'::jsonb,
            started_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
            completed_at        TIMESTAMPTZ
        );
        """
    )
    # The dashboard feed lists runs newest-first; index started_at to keep it cheap.
    op.execute(
        "CREATE INDEX ix_release_runs_started_at ON release_runs (started_at DESC);"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_release_runs_started_at;")
    op.execute("DROP TABLE IF EXISTS release_runs;")
