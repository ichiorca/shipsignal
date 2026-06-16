"""perf indexes for the cross-run dashboard reads (skill usage + learning trend)

Revision ID: 0029_review_perf_indexes
Revises: 0028_scheduled_publishes_sending
Create Date: 2026-06-16

Staff-review fix (P2 perf/scalability): two uncached `force-dynamic` dashboard reads aggregate
growing tables with no supporting index.

1. `/capabilities` -> `listSkillUsage` runs a full `GROUP BY skill_name` with `COUNT(DISTINCT ...)`
   over `skill_usage_events`, which only had an index on `artifact_id`. A covering index on the
   grouped/ordered columns lets Postgres avoid a seq-scan as the event table grows (it gains rows
   per artifact per skill invocation, so tens of thousands of rows arrive quickly).

2. `/learning` -> `listRunTrendPoints` filters `eval_runs` by `eval_type IN ('edit_distance',
   'feature_rejection_rate')` with a `DISTINCT ON` per run. A partial index keyed on those two
   types (newest first) backs that scan without bloating the index with the many other eval rows
   (rubric, evidence_coverage, ...).

Both are pure `CREATE INDEX` (additive, no data change); the downgrade drops them. constitution §6
(no schema drift) — paired with the queries in app/lib/db/skillUsage.ts and learningTrends.ts.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0029_review_perf_indexes"
down_revision: str | None = "0028_scheduled_publishes_sending"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Covering index for the listSkillUsage aggregate: leading skill_name (the GROUP BY / ORDER BY
    # key) then the columns it counts-distinct / maxes, so the rollup is index-driven.
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_skill_usage_events_skill_name "
        "ON skill_usage_events (skill_name, release_run_id, graph_name, node_name, created_at);"
    )
    # Partial index for the learning-trend DISTINCT ON: only the two metric types it reads, newest
    # first, scoped per run.
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_eval_runs_learning_types "
        "ON eval_runs (release_run_id, eval_type, created_at DESC) "
        "WHERE eval_type IN ('edit_distance', 'feature_rejection_rate');"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_eval_runs_learning_types;")
    op.execute("DROP INDEX IF EXISTS ix_skill_usage_events_skill_name;")
