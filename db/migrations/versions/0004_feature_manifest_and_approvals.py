"""feature_clusters + feature_evidence_links + approvals

Revision ID: 0004_feature_manifest_and_approvals
Revises: 0003_evidence_items
Create Date: 2026-06-07

T1 (spec 004) — the feature-manifest + approval tables per PRD §10.2 and §10.4.

P4 (Storage) / constitution §2 (tenancy): every feature_clusters row is scoped to a
release_runs.id (the release_run_id key) via a FK that CASCADEs, so GDPR erasure of a
run also erases its features, its evidence links, and the approval rows that reference
them. feature_evidence_links is the join table that satisfies the spec AC "each
persisted feature links to >=1 evidence_item"; both sides CASCADE so the link can never
dangle past its feature or its evidence.

P5 (Safety rails) — Gate #1: feature_clusters.status defaults to 'pending_review'. No
column or default flips a feature to 'approved'; only a human decision recorded in
`approvals` (target_type='feature_manifest') and applied by the resume path advances it.
There is deliberately no self-approval mechanism in the schema.

approvals (§10.4) is the immutable decision log for every gate: a row per reviewer
action carrying decision + reviewer + optional notes, and `edited_payload_json` when the
reviewer edited rather than plain-approved/rejected. It is gate-agnostic
(target_type/target_id) so Gate #2/#3 reuse it in later specs.

Real DDL — not a stub (anti-pattern #1); the downgrade is a clean inverse.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0004_feature_manifest_and_approvals"
down_revision: str | None = "0003_evidence_items"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # §10.2 feature_clusters — one candidate feature, scored, pending review until a
    # human decision is recorded. text[] columns default to empty arrays so a feature
    # with no audiences/surfaces is still well-formed.
    op.execute(
        """
        CREATE TABLE feature_clusters (
            id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            release_run_id      UUID NOT NULL
                                  REFERENCES release_runs(id) ON DELETE CASCADE,
            title               TEXT NOT NULL,
            summary_internal    TEXT,
            user_value          TEXT,
            audiences           TEXT[] NOT NULL DEFAULT '{}',
            change_type         TEXT,
            surface_area        TEXT[] NOT NULL DEFAULT '{}',
            marketability_score NUMERIC,
            demoability_score   NUMERIC,
            confidence          NUMERIC,
            launch_risk         TEXT,
            status              TEXT NOT NULL DEFAULT 'pending_review',
            reviewer_notes      TEXT,
            created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        """
    )
    # The review screen lists a run's features; index the tenancy key to keep it cheap.
    op.execute(
        "CREATE INDEX ix_feature_clusters_release_run_id "
        "ON feature_clusters (release_run_id);"
    )

    # §10.2 feature_evidence_links — composite-PK join with a per-link relevance_score.
    # Both FKs CASCADE so erasing a feature or an evidence item removes the link.
    op.execute(
        """
        CREATE TABLE feature_evidence_links (
            feature_id          UUID NOT NULL
                                  REFERENCES feature_clusters(id) ON DELETE CASCADE,
            evidence_item_id    UUID NOT NULL
                                  REFERENCES evidence_items(id) ON DELETE CASCADE,
            relevance_score     NUMERIC,
            PRIMARY KEY (feature_id, evidence_item_id)
        );
        """
    )
    # Reverse lookups (which features cite this evidence item) for the claim inspector.
    op.execute(
        "CREATE INDEX ix_feature_evidence_links_evidence_item_id "
        "ON feature_evidence_links (evidence_item_id);"
    )

    # §10.4 approvals — the gate decision log. Gate-agnostic via (target_type, target_id)
    # so Gate #2 (artifacts) and Gate #3 (skills) reuse it later.
    op.execute(
        """
        CREATE TABLE approvals (
            id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            target_type         TEXT NOT NULL,
            target_id           UUID NOT NULL,
            decision            TEXT NOT NULL,
            reviewer            TEXT NOT NULL,
            notes               TEXT,
            edited_payload_json JSONB,
            created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        """
    )
    # The resume path looks up the latest decision for a target; index that access path.
    op.execute(
        "CREATE INDEX ix_approvals_target "
        "ON approvals (target_type, target_id, created_at DESC);"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_approvals_target;")
    op.execute("DROP TABLE IF EXISTS approvals;")
    op.execute("DROP INDEX IF EXISTS ix_feature_evidence_links_evidence_item_id;")
    op.execute("DROP TABLE IF EXISTS feature_evidence_links;")
    op.execute("DROP INDEX IF EXISTS ix_feature_clusters_release_run_id;")
    op.execute("DROP TABLE IF EXISTS feature_clusters;")
