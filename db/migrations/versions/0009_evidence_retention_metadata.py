"""evidence retention/TTL + lawful-basis metadata

Revision ID: 0009_evidence_retention_metadata
Revises: 0008_skill_learning_ledger
Create Date: 2026-06-08

T1 (spec 010) — record a lawful basis + processing purpose and a retention deadline on
every PII-bearing ``evidence_items`` row, and index the deadline so the TTL sweep is
cheap (constitution §5 GDPR rails: data minimization + storage limitation;
domain-gdpr-rules "set retention/TTL on everything that can hold PII").

GDPR grounding: Art.5(1)(c) data minimization, Art.5(1)(e) storage limitation (keep
personal data no longer than necessary), Art.6 lawful basis. Evidence excerpts are the
only PII-bearing rows in the schema (PRD §10.1) — features/claims/artifacts derive from
already-redacted evidence — so retention metadata lives here, at the source.

The three columns carry NOT NULL DEFAULTs so the existing spec-002 insert path
(``S3AuroraEvidenceSink.record``) records them structurally without a code change: every
row gets a recorded lawful basis, a recorded purpose, and a 180-day retention deadline
measured from ``created_at``. The canonical policy (the same 180-day window + basis) is
mirrored in ``release_worker.retention`` so the sweep and the DDL never drift.

``retention.sweep_expired_evidence`` enforces the deadline by deleting the row AND its S3
blob once ``retention_expires_at`` passes (P5: deletion spans Aurora *and* S3, never just
one). The partial index covers exactly the sweep predicate
(``retention_expires_at < now()``).

Real DDL — not a stub (anti-pattern #1); the downgrade is a clean inverse.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0009_evidence_retention_metadata"
down_revision: str | None = "0008_skill_learning_ledger"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Canonical retention window for PII-bearing evidence. Mirrored as
# ``retention.DEFAULT_RETENTION_DAYS`` so the DDL default and the code policy agree.
_RETENTION_DAYS = 180


def upgrade() -> None:
    # lawful_basis (Art.6) + processing_purpose (Art.5(1)(b) purpose limitation): recorded
    # on every row so the basis on which personal data is held is auditable. Defaults match
    # this internal single-org tool's basis/purpose; a future per-source basis can override.
    op.execute(
        "ALTER TABLE evidence_items "
        "ADD COLUMN lawful_basis TEXT NOT NULL DEFAULT 'legitimate_interests';"
    )
    op.execute(
        "ALTER TABLE evidence_items "
        "ADD COLUMN processing_purpose TEXT NOT NULL "
        "DEFAULT 'release_content_generation';"
    )
    # retention_expires_at (Art.5(1)(e)): the deadline after which the row + its S3 blob are
    # swept. Measured from created_at so back-dated rows expire on schedule, not from now().
    op.execute(
        "ALTER TABLE evidence_items "
        f"ADD COLUMN retention_expires_at TIMESTAMPTZ NOT NULL "
        f"DEFAULT (now() + interval '{_RETENTION_DAYS} days');"
    )
    # Backfill existing rows from their own created_at (the column DEFAULT used now() for the
    # ADD COLUMN rewrite, which would over-retain older rows).
    op.execute(
        "UPDATE evidence_items "
        f"SET retention_expires_at = created_at + interval '{_RETENTION_DAYS} days';"
    )
    # The TTL sweep selects WHERE retention_expires_at < now(); a partial-friendly btree on
    # the deadline keeps that scan cheap as the table grows.
    op.execute(
        "CREATE INDEX ix_evidence_items_retention_expires_at "
        "ON evidence_items (retention_expires_at);"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_evidence_items_retention_expires_at;")
    op.execute("ALTER TABLE evidence_items DROP COLUMN IF EXISTS retention_expires_at;")
    op.execute("ALTER TABLE evidence_items DROP COLUMN IF EXISTS processing_purpose;")
    op.execute("ALTER TABLE evidence_items DROP COLUMN IF EXISTS lawful_basis;")
