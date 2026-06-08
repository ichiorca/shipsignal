"""media_assets reconcile to PRD §10.6 + broken-step support

Revision ID: 0013_media_assets_reconcile
Revises: 0012_eval_runs
Create Date: 2026-06-08

T2 (spec 014) — reconcile ``media_assets`` (migration 0007) to PRD §10.6 and make it able to
record a §16.3 broken-step asset.

P4 (Storage) / constitution §4 — the table still carries only the S3 key + metadata, never the
binary. Three reconciliations, all reversible:

* §10.6 column names — the spec-required names are ``artifact_id`` (the source artifact linkage)
  and ``metadata_json`` (the provenance/metadata blob). 0007 shipped them as ``source_artifact_id``
  / ``provenance_json``; rename in place so the DB matches §10.6 exactly. The app keeps its
  semantic field names (``source_artifact_id`` / ``provenance``) via a documented, consistent
  mapping applied in the two data-access modules (``aurora_media.py`` INSERT and
  ``app/lib/db/mediaAssets.ts`` SELECT) — the AC's "documented, consistent mapping" option.
* §10.6 ``transcript`` column — 0007 dropped it; add it. It preserves the narration script the
  media was narrated from (§16.3 "preserve transcript and narration script"), kept in Aurora text
  (not S3) so the dashboard text-alternative renders without a presign.
* §16.3 broken-step rows — a failed media step is surfaced as a persisted row with
  ``status='broken'`` whose ``metadata_json`` names the broken step, rather than failing the whole
  run opaquely. Such a row may legitimately have no final media (the step broke before/at storage),
  so ``s3_uri`` and the (additive, non-§10.6) ``content_type`` column drop NOT NULL. A CHECK keeps
  integrity: only a ``broken`` row may omit ``s3_uri`` — every ready/generated asset still has one.

Real DDL/DML — not a stub (anti-pattern #1); the downgrade is a clean inverse (it coalesces the
nullable columns back to '' before restoring NOT NULL so it never strands a row).
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0013_media_assets_reconcile"
down_revision: str | None = "0012_eval_runs"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # §10.6 names: source_artifact_id → artifact_id, provenance_json → metadata_json. RENAME
    # preserves the data and every FK/index on the columns (no copy, no backfill needed here).
    op.execute(
        "ALTER TABLE media_assets RENAME COLUMN source_artifact_id TO artifact_id;"
    )
    op.execute(
        "ALTER TABLE media_assets RENAME COLUMN provenance_json TO metadata_json;"
    )

    # §10.6 transcript — the preserved narration script (§16.3). Nullable: pre-existing rows
    # predate transcript capture, and an audio-only / broken row may have none.
    op.execute("ALTER TABLE media_assets ADD COLUMN transcript TEXT;")
    # Backfill existing rows: lift a transcript out of metadata_json if one was ever stashed
    # there (older rows won't have it → stays NULL). Real DML, idempotent.
    op.execute(
        """
        UPDATE media_assets
           SET transcript = metadata_json ->> 'transcript'
         WHERE transcript IS NULL
           AND metadata_json ? 'transcript';
        """
    )

    # §16.3 broken-step rows may have no stored media — relax the two storage columns and guard
    # the relaxation with a CHECK so ONLY a 'broken' row may omit s3_uri (ready/generated keep it).
    op.execute("ALTER TABLE media_assets ALTER COLUMN s3_uri DROP NOT NULL;")
    op.execute("ALTER TABLE media_assets ALTER COLUMN content_type DROP NOT NULL;")
    op.execute(
        """
        ALTER TABLE media_assets
          ADD CONSTRAINT ck_media_assets_s3_uri_required
          CHECK (status = 'broken' OR s3_uri IS NOT NULL);
        """
    )


def downgrade() -> None:
    # Drop the CHECK first so the NOT NULL restore below can't trip it.
    op.execute(
        "ALTER TABLE media_assets DROP CONSTRAINT IF EXISTS ck_media_assets_s3_uri_required;"
    )
    # Coalesce the now-nullable columns back to '' so restoring NOT NULL never strands a broken
    # row (reversible without row loss; the broken rows simply lose their null-ness).
    op.execute("UPDATE media_assets SET s3_uri = '' WHERE s3_uri IS NULL;")
    op.execute("UPDATE media_assets SET content_type = '' WHERE content_type IS NULL;")
    op.execute("ALTER TABLE media_assets ALTER COLUMN content_type SET NOT NULL;")
    op.execute("ALTER TABLE media_assets ALTER COLUMN s3_uri SET NOT NULL;")

    op.execute("ALTER TABLE media_assets DROP COLUMN IF EXISTS transcript;")
    op.execute(
        "ALTER TABLE media_assets RENAME COLUMN metadata_json TO provenance_json;"
    )
    op.execute(
        "ALTER TABLE media_assets RENAME COLUMN artifact_id TO source_artifact_id;"
    )
