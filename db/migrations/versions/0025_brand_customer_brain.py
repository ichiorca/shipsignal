"""brand & customer brain: icp_segments + company_voice_exemplars + messaging_claims

Revision ID: 0025_brand_customer_brain
Revises: 0024_approvals_dedupe_key
Create Date: 2026-06-15

Product gap (PO review): ShipSignal generated content with a clean engine but had NO configurable
company identity — voice lived as a static repo SKILL.md, "audience" was a free-text label the LLM
invented per feature, and there was no ICP, no positioning library, and no corpus of the company's
real published content to ground "in your voice" in. This migration adds the three config objects
that close that gap (mirroring the peer hindsight-guild model so a future merge is a join, not a
rewrite), aligned to ShipSignal's stack:

  * icp_segments              — the canonical "who we market to" (name, buyer roles, pains,
                                objections, approved angles). First-class + queryable, not an
                                opaque id. Grounds generation and the audience_relevance eval.
  * company_voice_exemplars   — the company's OWN published content (blog/post/email/etc.),
                                embedded in pgvector via Bedrock. Retrieved by similarity to the
                                release + channel at generation time and injected as few-shot
                                style — the embeddings-driven "in your voice" (the inverse of
                                hindsight-guild's customer_voice corpus).
  * messaging_claims          — approved, evidence-backed positioning/value-props scoped by ICP;
                                injected into generation and validated by the claim/check node.

Real DDL — not a stub; the downgrade is a clean inverse (drop in dependency order). Single-org
tool (constitution §2): one company's profile, no tenant column. Skills stay repo-authored — this
is CONFIG/DATA, not a skill (constitution §1/§9.2).
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0025_brand_customer_brain"
down_revision: str | None = "0024_approvals_dedupe_key"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # --- icp_segments: the canonical "who we market to" ---------------------------------------
    # id is a human-readable slug (e.g. 'seg_merchant_dtc') so it reads in joins and mirrors the
    # peer repo's segment ids for the eventual merge. status gates which segments are in play.
    op.execute(
        """
        CREATE TABLE icp_segments (
            id              TEXT PRIMARY KEY,
            name            TEXT NOT NULL,
            description     TEXT NOT NULL DEFAULT '',
            buyer_roles     TEXT[] NOT NULL DEFAULT '{}',
            pain_points     TEXT[] NOT NULL DEFAULT '{}',
            objections      TEXT[] NOT NULL DEFAULT '{}',
            approved_angles TEXT[] NOT NULL DEFAULT '{}',
            status          TEXT NOT NULL DEFAULT 'active'
                              CHECK (status IN ('active', 'archived')),
            created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        """
    )

    # --- company_voice_exemplars: the embedded voice corpus ------------------------------------
    # body_text is the company's own published content (already public — no redaction gate needed,
    # unlike release evidence). channel scopes an exemplar to an artifact type (or 'any'). The
    # embedding is populated by the WORKER (Bedrock) — never the Vercel app (constitution §1); it
    # stays NULL until embedded, and retrieval falls back to lexical for un-embedded rows.
    op.execute(
        """
        CREATE TABLE company_voice_exemplars (
            id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            title          TEXT NOT NULL DEFAULT '',
            body_text      TEXT NOT NULL,
            channel        TEXT NOT NULL DEFAULT 'any',
            source         TEXT,
            icp_segment_id TEXT REFERENCES icp_segments(id) ON DELETE SET NULL,
            embedding      vector(1536),
            created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        """
    )
    # HNSW ANN index for cosine (<=>) retrieval, partial on embedded rows (mirrors
    # ix_evidence_items_embedding_hnsw from migration 0018).
    op.execute(
        """
        CREATE INDEX ix_company_voice_exemplars_embedding_hnsw
            ON company_voice_exemplars USING hnsw (embedding vector_cosine_ops)
            WHERE embedding IS NOT NULL;
        """
    )
    op.execute(
        "CREATE INDEX ix_company_voice_exemplars_channel "
        "ON company_voice_exemplars (channel);"
    )

    # --- messaging_claims: approved, evidence-backed positioning per ICP -----------------------
    # applies_to_icp is the join key (segment slugs). evidence_url lets the claim/check node defend
    # any approved claim that survives into a draft. status gates which claims generation may use.
    op.execute(
        """
        CREATE TABLE messaging_claims (
            id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            claim_text     TEXT NOT NULL,
            claim_type     TEXT NOT NULL DEFAULT 'positioning'
                             CHECK (claim_type IN ('positioning', 'feature_proof', 'differentiator')),
            evidence_url   TEXT,
            applies_to_icp TEXT[] NOT NULL DEFAULT '{}',
            status         TEXT NOT NULL DEFAULT 'approved'
                             CHECK (status IN ('draft', 'approved', 'archived')),
            created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        """
    )
    op.execute("CREATE INDEX ix_messaging_claims_status ON messaging_claims (status);")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS messaging_claims;")
    op.execute("DROP TABLE IF EXISTS company_voice_exemplars;")
    op.execute("DROP TABLE IF EXISTS icp_segments;")
