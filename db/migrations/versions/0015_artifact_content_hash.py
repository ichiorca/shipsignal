"""artifacts.content_hash — §18.3 tamper-evident artifact hash

Revision ID: 0015_artifact_content_hash
Revises: 0014_release_status_full_lifecycle
Create Date: 2026-06-08

T1 (spec 016) — the §18.3 audit trail requires every artifact to store a content hash, but the
``artifacts`` body is a mutable row with no hash. Add ``content_hash`` and backfill every existing
row with the SAME canonical digest the worker mints on generation and the dashboard recomputes on
edit/approval (``worker/.../content_hash.py`` / ``app/lib/contentHash.ts``):

    sha256( utf-8( coalesce(title,'') || E'\\n\\n' || coalesce(body_markdown,'') ) )  -> hex

P5 (Safety rails) / §18.3: the hash is a pure function of the artifact's content, so a tampered
body no longer matches its recorded/snapshotted hash. ``pgcrypto`` provides ``digest()`` for the
deterministic backfill (``CREATE EXTENSION IF NOT EXISTS`` is idempotent and already the source of
``gen_random_uuid`` in this schema). The column is left nullable (no app reads it as NOT NULL) but
backfilled non-null for every present row; new rows are written WITH the hash by the worker.

Real DDL/DML — not a stub (anti-pattern #1); the downgrade drops the column (a clean inverse).
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0015_artifact_content_hash"
down_revision: str | None = "0014_release_status_full_lifecycle"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # digest() lives in pgcrypto; ensure it is present for the deterministic backfill.
    op.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto;")
    op.execute("ALTER TABLE artifacts ADD COLUMN content_hash TEXT;")
    # Backfill existing rows with the canonical content hash (title + "\n\n" + body). The
    # expression mirrors content_hash.py / contentHash.ts EXACTLY so a re-hash in either language
    # matches the stored value (§18.3 tamper-evidence).
    op.execute(
        """
        UPDATE artifacts
           SET content_hash = encode(
                 digest(
                   coalesce(title, '') || E'\\n\\n' || coalesce(body_markdown, ''),
                   'sha256'
                 ),
                 'hex'
               )
         WHERE content_hash IS NULL;
        """
    )


def downgrade() -> None:
    op.execute("ALTER TABLE artifacts DROP COLUMN IF EXISTS content_hash;")
