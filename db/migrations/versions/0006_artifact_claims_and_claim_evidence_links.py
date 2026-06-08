"""artifact_claims + claim_evidence_links

Revision ID: 0006_artifact_claims_and_claim_evidence_links
Revises: 0005_content_artifacts_and_skill_provenance
Create Date: 2026-06-08

T1 (spec 006) — the claim-provenance tables of content_generation_graph (PRD §10.3,
§8.3 claim-level contract). ``artifact_claims`` decomposes a persisted artifact into
typed claims (capability/performance/…) each carrying support_status + risk_level;
``claim_evidence_links`` is the provenance join that grounds a claim in concrete
evidence_items with a support_score. Spec 005 created ``artifacts`` + the skill
provenance pair; this slice adds the claim layer that Gate #2 reviews.

P5 (Safety rails) / constitution §5 — claim-level provenance: a claim is only
*approvable* once it has >=1 claim_evidence_links row; an unlinkable claim is persisted
``support_status='unsupported'`` and the Gate #2 approve path refuses it. ``checker_metadata_json``
records the deterministic-check + Guardrail findings (the §18.3 audit trail) so a reviewer
sees *why* a claim was flagged or blocked.

P4 (Storage) / constitution §2 (tenancy) + GDPR erasure (constitution §5): every row chains
to a release_runs.id through its artifact and CASCADEs — erasing a run drops its artifacts,
their claims, and the claim_evidence_links. claim_evidence_links also CASCADEs on
evidence_item_id so a data-subject erasure of an evidence row removes the link (never
orphaning a claim against deleted evidence).

Real DDL — not a stub (anti-pattern #1); the downgrade is a clean inverse.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0006_artifact_claims_and_claim_evidence_links"
down_revision: str | None = "0005_content_artifacts_and_skill_provenance"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # §10.3 artifact_claims — one decomposed claim of an artifact. artifact_id CASCADEs so
    # erasing the run (→ artifact) erases its claims. support_status is set deterministically
    # by link_claims_to_evidence ('supported' only with a real evidence link); risk_level is
    # the model-proposed/normalized risk. checker_metadata_json carries the per-claim check
    # findings (unsupported/metric/secret/guardrail) for the §18.3 audit trail.
    op.execute(
        """
        CREATE TABLE artifact_claims (
            id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            artifact_id           UUID NOT NULL
                                    REFERENCES artifacts(id) ON DELETE CASCADE,
            claim_text            TEXT NOT NULL,
            claim_type            TEXT NOT NULL,
            support_status        TEXT NOT NULL,
            risk_level            TEXT NOT NULL,
            checker_metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        """
    )
    # "Show this artifact's claims" is the Gate #2 read; index by artifact.
    op.execute(
        "CREATE INDEX ix_artifact_claims_artifact_id ON artifact_claims (artifact_id);"
    )

    # §10.3 claim_evidence_links — the provenance join grounding a claim in evidence. The
    # composite PK makes a (claim, evidence) link idempotent (re-linking is a no-op).
    # CASCADE on BOTH FKs: erasing a claim (via its artifact/run) or a data-subject erasure
    # of an evidence_items row removes the link, so no link ever dangles (constitution §5).
    op.execute(
        """
        CREATE TABLE claim_evidence_links (
            claim_id         UUID NOT NULL
                               REFERENCES artifact_claims(id) ON DELETE CASCADE,
            evidence_item_id UUID NOT NULL
                               REFERENCES evidence_items(id) ON DELETE CASCADE,
            support_score    NUMERIC,
            PRIMARY KEY (claim_id, evidence_item_id)
        );
        """
    )
    # "Which evidence supports this claim" reads by claim_id (covered by the PK's leading
    # column); add the reverse index so an evidence erasure can find its links cheaply.
    op.execute(
        "CREATE INDEX ix_claim_evidence_links_evidence_item_id "
        "ON claim_evidence_links (evidence_item_id);"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_claim_evidence_links_evidence_item_id;")
    op.execute("DROP TABLE IF EXISTS claim_evidence_links;")
    op.execute("DROP INDEX IF EXISTS ix_artifact_claims_artifact_id;")
    op.execute("DROP TABLE IF EXISTS artifact_claims;")
