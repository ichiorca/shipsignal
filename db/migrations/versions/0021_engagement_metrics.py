"""engagement_metrics — aggregate engagement outcomes per exported artifact

Revision ID: 0021_engagement_metrics
Revises: 0020_gate_notifications
Create Date: 2026-06-09

T1 (spec 021) — close the outcome loop with the smallest GDPR-safe footprint: one row is
one AGGREGATE count (views / clicks / conversions) for one artifact as of one date, from
one ingestion source. The schema is aggregate-only BY CONSTRUCTION (domain-gdpr-rules /
spec AC: "no column that could hold user-level data"): the only free-form-capable columns
are `metric` and `source`, and both carry CHECK constraints pinning them to closed
vocabularies, so no user id, IP, cookie, or event payload can ever be persisted here.

Idempotent ingestion (aurora rules): UNIQUE (artifact_id, metric, as_of, source) is the
upsert key — re-posting the same CSV or API batch overwrites the same rows instead of
inflating counts. `as_of` records WHICH day the aggregate snapshot describes; `source`
(`manual_csv` | `api`) records provenance of the number (P4: every row carries lineage).

P4 (Storage) / constitution §2: every row carries `release_run_id` (the tenancy key) and
CASCADE-deletes with its run — GDPR erasure of a run also erases its engagement trail.
`artifact_id` likewise CASCADE-references `artifacts`, so an erased artifact never leaves
orphaned outcome rows.

Real DDL — not a stub (anti-pattern #1); the downgrade is a clean inverse.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0021_engagement_metrics"
down_revision: str | None = "0020_gate_notifications"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # value is BIGINT (a popular post's view count can exceed int4) and non-negative —
    # an aggregate count can never be below zero. A row is a cumulative snapshot "as of"
    # a date; the freshest as_of per (artifact, metric) is the current truth the readers
    # take, so corrections are just a newer row (or an upsert of the same key).
    op.execute(
        """
        CREATE TABLE engagement_metrics (
            id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            release_run_id UUID NOT NULL
                             REFERENCES release_runs(id) ON DELETE CASCADE,
            artifact_id    UUID NOT NULL
                             REFERENCES artifacts(id) ON DELETE CASCADE,
            metric         TEXT NOT NULL
                             CHECK (metric IN ('views', 'clicks', 'conversions')),
            value          BIGINT NOT NULL CHECK (value >= 0),
            as_of          DATE NOT NULL,
            source         TEXT NOT NULL
                             CHECK (source IN ('manual_csv', 'api')),
            created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
            UNIQUE (artifact_id, metric, as_of, source)
        );
        """
    )
    # The ROI view and the eval outcome metrics both read by run.
    op.execute(
        "CREATE INDEX ix_engagement_metrics_release_run_id "
        "ON engagement_metrics (release_run_id);"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_engagement_metrics_release_run_id;")
    op.execute("DROP TABLE IF EXISTS engagement_metrics;")
