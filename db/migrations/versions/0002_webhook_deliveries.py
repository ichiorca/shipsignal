"""webhook_deliveries dedupe table

Revision ID: 0002_webhook_deliveries
Revises: 0001_release_runs
Create Date: 2026-06-07

T4 (spec 001) — durable replay protection for inbound webhooks. GitHub (and the other
providers) deliver at-least-once, so the route dedupes on the delivery GUID via
``INSERT ... ON CONFLICT (delivery_guid) DO NOTHING`` (see app/lib/db/webhookDeliveries.ts).
The PRIMARY KEY on delivery_guid is what makes "first writer wins" atomic across the
serverless fleet. Real DDL — not a stub (anti-pattern #1).
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0002_webhook_deliveries"
down_revision: str | None = "0001_release_runs"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE webhook_deliveries (
            delivery_guid TEXT PRIMARY KEY,
            source        TEXT NOT NULL,
            received_at   TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS webhook_deliveries;")
