"""approved_artifact_snapshots — §18.3 immutable approved-content record

Revision ID: 0016_approved_artifact_snapshots
Revises: 0015_artifact_content_hash
Create Date: 2026-06-08

T2 (spec 016) — §18.3 requires the audit trail to store the FINAL APPROVED CONTENT as a
tamper-evident record. The ``artifacts`` row is mutable (a reviewer can still edit title/body),
so the approved content must be snapshotted into a record DISTINCT from that working row. At Gate
#2 approval the dashboard writes one row here capturing every §18.3 field at the moment of
approval:

  release run ID, model ID, prompt/template version, skill versions used, evidence IDs, claim
  support statuses, reviewer + decision, the final title/body, the generated + approved
  timestamps, and the content hash of the approved body.

P5 (Safety rails) / §18.3 immutability: ``UNIQUE (artifact_id)`` + the app's ``ON CONFLICT
(artifact_id) DO NOTHING`` make this append-only — the FIRST approved content is preserved and a
re-approval can never overwrite it (a later edit lives on the mutable row, not here). The
``content_hash`` is the same canonical digest as ``artifacts.content_hash`` (migration 0015), so a
tampered approved body no longer matches its snapshot.

P4 (Storage) / constitution §2 (tenancy + §5 erasure): every row carries ``release_run_id`` and
CASCADE-deletes with its artifact / run, so GDPR erasure of a run also erases its approved
snapshots (Aurora side of constitution §5). ``approval_id`` SET NULL on delete keeps the snapshot
even if the approvals row is later pruned — the reviewer/decision are also denormalized here so the
audit record stands alone.

Real DDL — not a stub (anti-pattern #1); the downgrade is a clean inverse.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0016_approved_artifact_snapshots"
down_revision: str | None = "0015_artifact_content_hash"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # §18.3 final-approved-content record. One immutable row per approved artifact (UNIQUE on
    # artifact_id; the app upserts ON CONFLICT DO NOTHING so the first approved content stands).
    op.execute(
        """
        CREATE TABLE approved_artifact_snapshots (
            id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            artifact_id         UUID NOT NULL
                                  REFERENCES artifacts(id) ON DELETE CASCADE,
            release_run_id      UUID NOT NULL
                                  REFERENCES release_runs(id) ON DELETE CASCADE,
            approval_id         UUID REFERENCES approvals(id) ON DELETE SET NULL,
            artifact_type       TEXT NOT NULL,
            model_id            TEXT,
            prompt_version      TEXT,
            skill_versions_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            evidence_ids_json   JSONB NOT NULL DEFAULT '[]'::jsonb,
            claim_support_json  JSONB NOT NULL DEFAULT '[]'::jsonb,
            reviewer            TEXT NOT NULL,
            reviewer_decision   TEXT NOT NULL,
            final_title         TEXT,
            final_body_markdown TEXT NOT NULL,
            content_hash        TEXT NOT NULL,
            generated_at        TIMESTAMPTZ,
            approved_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
            UNIQUE (artifact_id)
        );
        """
    )
    # "All approved artifacts for this run" is the audit read; index the tenancy key.
    op.execute(
        "CREATE INDEX ix_approved_artifact_snapshots_release_run_id "
        "ON approved_artifact_snapshots (release_run_id);"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_approved_artifact_snapshots_release_run_id;")
    op.execute("DROP TABLE IF EXISTS approved_artifact_snapshots;")
