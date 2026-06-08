"""media_assets

Revision ID: 0007_media_assets
Revises: 0006_artifact_claims_and_claim_evidence_links
Create Date: 2026-06-08

T1 (spec 008) — the persisted output of ``media_generation_graph`` (PRD §5.4). One
``media_assets`` row records a demo-media artifact (captured demo video / narrated audio
digest) assembled from a Gate#2-approved demo script: its S3 location, duration, and the
provenance that ties the rendered media back to the approved source artifact + the inputs
that produced it (click-path hash, narration content hash, voice/model ids).

P4 (Storage) / constitution §4 — the large binary (video/audio) lives in S3; Aurora carries
only the ``s3_uri`` key + metadata, never the blob. ``provenance_json`` is the §18.3 audit
trail for media: which approved ``demo_script`` artifact it derives from, the validated
click-path hash Playwright executed, the narration content hash (the ElevenLabs idempotency
key), and the voice/model ids — so a reviewer can trace the rendered media to its evidence.

P4 (Storage) / constitution §2 (tenancy) + GDPR erasure (constitution §5) — every row chains
to ``release_runs.id`` and CASCADEs: erasing a run drops its media_assets rows (the S3 objects
are erased by the data-subject-rights worker that walks these keys). ``feature_id`` is the
optional originating feature; it ``SET NULL`` on feature delete so a media row is never
orphaned against a dropped feature while the run-level CASCADE remains the erasure path.

Real DDL — not a stub (anti-pattern #1); the downgrade is a clean inverse.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0007_media_assets"
down_revision: str | None = "0006_artifact_claims_and_claim_evidence_links"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # §5.4 media_assets — one rendered demo-media asset for a run. release_run_id CASCADEs so a
    # GDPR run erasure drops the row (and the keyed S3 objects are swept by the rights worker);
    # feature_id SET NULL keeps a media row from dangling against a dropped feature.
    # source_artifact_id references the Gate#2-approved demo_script the media derives from.
    # media_type is the rendered kind ('demo_video' | 'release_audio_digest'); status starts
    # 'ready' (the asset is only persisted once stored in S3). provenance_json is the audit
    # trail (click-path hash, narration content hash, voice/model ids).
    op.execute(
        """
        CREATE TABLE media_assets (
            id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            release_run_id     UUID NOT NULL
                                 REFERENCES release_runs(id) ON DELETE CASCADE,
            feature_id         UUID
                                 REFERENCES feature_clusters(id) ON DELETE SET NULL,
            source_artifact_id UUID
                                 REFERENCES artifacts(id) ON DELETE SET NULL,
            media_type         TEXT NOT NULL,
            s3_uri             TEXT NOT NULL,
            content_type       TEXT NOT NULL,
            duration_seconds   NUMERIC,
            status             TEXT NOT NULL DEFAULT 'ready',
            provenance_json    JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        """
    )
    # "Show this run's media" is the dashboard read (PRD §13.1 media preview); index by run.
    op.execute(
        "CREATE INDEX ix_media_assets_release_run_id ON media_assets (release_run_id);"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_media_assets_release_run_id;")
    op.execute("DROP TABLE IF EXISTS media_assets;")
