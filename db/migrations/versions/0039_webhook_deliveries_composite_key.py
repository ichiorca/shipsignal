"""webhook_deliveries: composite (source, delivery_guid) dedupe key

Revision ID: 0039_webhook_deliveries_composite_key
Revises: 0038_connections
Create Date: 2026-06-29

T4 (spec 001) follow-up — the original table keyed dedupe on ``delivery_guid`` alone
(PRIMARY KEY in 0002), while ``AuroraDeliveryGuidStore`` is parameterized by ``source``.
GitHub delivery GUIDs are unique, but a future second provider whose id space collides
with GitHub's would have its delivery silently dropped as a "replay" — a false dedupe
across sources. The replay namespace is per-source, so the dedupe key must be the
composite ``(source, delivery_guid)``.

Backward compatible: existing GitHub rows all carry source='github' and distinct GUIDs,
so they are unique under the composite key with no data rewrite. We swap the guid-only
PRIMARY KEY for a composite one (see app/lib/db/webhookDeliveries.ts:
``INSERT ... ON CONFLICT (source, delivery_guid) DO NOTHING``). Real DDL — not a stub.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0039_webhook_deliveries_composite_key"
down_revision: str | None = "0038_connections"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Drop the guid-only PK (named by Postgres convention) and re-key on (source, delivery_guid).
    op.execute(
        """
        ALTER TABLE webhook_deliveries
            DROP CONSTRAINT IF EXISTS webhook_deliveries_pkey;
        """
    )
    op.execute(
        """
        ALTER TABLE webhook_deliveries
            ADD CONSTRAINT webhook_deliveries_pkey
            PRIMARY KEY (source, delivery_guid);
        """
    )


def downgrade() -> None:
    op.execute(
        """
        ALTER TABLE webhook_deliveries
            DROP CONSTRAINT IF EXISTS webhook_deliveries_pkey;
        """
    )
    op.execute(
        """
        ALTER TABLE webhook_deliveries
            ADD CONSTRAINT webhook_deliveries_pkey
            PRIMARY KEY (delivery_guid);
        """
    )
