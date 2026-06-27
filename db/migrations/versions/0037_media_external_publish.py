"""media_assets external-publish provenance: record where a rendered demo video was published

Adds the columns the YouTube publish integration writes when an operator publishes a finished
``demo_video`` media asset to an external platform (PRD §5.4 last-mile distribution; constitution
§2 human-gated distribution — NOT autopublish). All nullable/additive so existing rows and the
``ck_media_assets_s3_uri_required`` CHECK are untouched.

  * external_platform   — e.g. 'youtube' (the destination; null until published)
  * external_url        — the public/unlisted watch URL (e.g. https://youtu.be/<id>)
  * external_video_id   — the platform's id (YouTube videoId), for idempotent re-checks
  * published_at        — when the upload succeeded
  * published_by        — the accountable reviewer who clicked publish (mirrors the §18.1 pattern)

Mirrors the artifact-publish audit shape (an ``approvals`` dedupe marker still gates the upload);
these columns are the media-side record of the outcome so the dashboard can link to the live video.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0037_media_external_publish"
down_revision: str | None = "0036_approvals_dedupe_state"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE media_assets
            ADD COLUMN external_platform TEXT,
            ADD COLUMN external_url      TEXT,
            ADD COLUMN external_video_id TEXT,
            ADD COLUMN published_at      TIMESTAMPTZ,
            ADD COLUMN published_by      TEXT
        """
    )


def downgrade() -> None:
    op.execute(
        """
        ALTER TABLE media_assets
            DROP COLUMN IF EXISTS external_platform,
            DROP COLUMN IF EXISTS external_url,
            DROP COLUMN IF EXISTS external_video_id,
            DROP COLUMN IF EXISTS published_at,
            DROP COLUMN IF EXISTS published_by
        """
    )
