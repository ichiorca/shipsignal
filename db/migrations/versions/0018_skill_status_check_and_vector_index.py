"""skill_revision_candidates.status CHECK + evidence_items HNSW vector index

Revision ID: 0018_skill_status_check_and_vector_index
Revises: 0017_skill_promotion_mode
Create Date: 2026-06-09

Round-2 review fixes:

* #6 — ``skill_revision_candidates.status`` had no CHECK constraint, so an out-of-lattice
  value could be written and would later throw at the TS read boundary
  (``parseSkillCandidateStatus``). Add the DB-side floor over the seven PRD §13.3 statuses
  (mirrors the ``release_runs`` status CHECK added in 0014). The PR-mode promotion path
  (spec 018) legitimately writes ``'approved'`` (approved, PR open, not yet merged), which is
  in the lattice.

* #7 — the §11 pgvector cosine retrieval (``ORDER BY embedding <=> %s``) had no ANN index, so
  it sequential-scanned + full-sorted each run's evidence. Add an HNSW index with
  ``vector_cosine_ops`` (matches the ``<=>`` cosine operator), partial on the populated rows.

Real DDL — not a stub; the downgrade is a clean inverse.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0018_skill_status_check_and_vector_index"
down_revision: str | None = "0017_skill_promotion_mode"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # #6 — DB-side lattice floor for the skill-candidate status (the 7 SKILL_CANDIDATE_STATUSES).
    op.execute(
        """
        ALTER TABLE skill_revision_candidates
            ADD CONSTRAINT skill_revision_candidates_status_check
            CHECK (status IN (
                'draft', 'pending_review', 'approved', 'rejected',
                'promoted', 'failed', 'suppressed_duplicate'
            ));
        """
    )

    # #7 — HNSW ANN index for the cosine (<=>) semantic-retrieval query (PRD §11). Partial on
    # the non-null embeddings so it stays lean for runs whose evidence is not embedded.
    op.execute(
        """
        CREATE INDEX ix_evidence_items_embedding_hnsw
            ON evidence_items USING hnsw (embedding vector_cosine_ops)
            WHERE embedding IS NOT NULL;
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_evidence_items_embedding_hnsw;")
    op.execute(
        "ALTER TABLE skill_revision_candidates "
        "DROP CONSTRAINT IF EXISTS skill_revision_candidates_status_check;"
    )
