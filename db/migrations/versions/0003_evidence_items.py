"""evidence_items table

Revision ID: 0003_evidence_items
Revises: 0002_webhook_deliveries
Create Date: 2026-06-07

T1 (spec 002) — the evidence_items table per PRD §10.1 + §6.3 evidence contract.
Every row is scoped to a release_runs.id (the release_run_id tenancy key, P4 /
constitution §2) via a FK that CASCADEs so GDPR erasure of a run also erases its
evidence (constitution §5 — data-subject erasure across Aurora). The embedding
vector(1536) column is nullable for now (populated by a later spec); it requires the
pgvector extension, created idempotently here. risk_flags / metadata_json are jsonb
with safe defaults. Real DDL — not a stub (anti-pattern #1).

Privacy note (P5 / constitution §5 "redact before persist"): the columns that hold
excerpt text (`redacted_excerpt`, and the S3 object referenced by
`raw_excerpt_s3_uri`) only ever receive content that has already passed the
redact_evidence node. The column name `raw_excerpt_s3_uri` is the PRD §6.3 contract
name; what it points at is the redacted full excerpt, never raw PII/secrets.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0003_evidence_items"
down_revision: str | None = "0002_webhook_deliveries"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # pgvector backs the embedding column. IF NOT EXISTS keeps re-apply idempotent.
    op.execute("CREATE EXTENSION IF NOT EXISTS vector;")
    op.execute(
        """
        CREATE TABLE evidence_items (
            id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            release_run_id      UUID NOT NULL
                                  REFERENCES release_runs(id) ON DELETE CASCADE,
            evidence_type       TEXT NOT NULL,
            source              TEXT NOT NULL,
            source_url          TEXT,
            repo                TEXT NOT NULL,
            file_path           TEXT,
            symbol_name         TEXT,
            raw_excerpt_s3_uri  TEXT,
            redacted_excerpt    TEXT,
            embedding           vector(1536),
            confidence          NUMERIC,
            risk_flags          JSONB NOT NULL DEFAULT '[]'::jsonb,
            metadata_json       JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        """
    )
    # The run-detail page lists a run's evidence; index the tenancy key to keep it cheap.
    op.execute(
        "CREATE INDEX ix_evidence_items_release_run_id "
        "ON evidence_items (release_run_id);"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_evidence_items_release_run_id;")
    op.execute("DROP TABLE IF EXISTS evidence_items;")
    # Drop the extension we created so the downgrade is a clean inverse; safe because
    # this is the only object that depends on it at this revision.
    op.execute("DROP EXTENSION IF EXISTS vector;")
