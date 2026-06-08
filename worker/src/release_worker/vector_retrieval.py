"""T3 (spec 017) — pure pgvector retrieval helpers (PRD §11 Retrieval Strategy).

The cosine query itself runs in the runtime Aurora adapter (``aurora_claims``), but the
parts that are pure — formatting the query vector as a pgvector literal, the cosine SQL
text, mapping result rows into candidates, and the *vector-then-lexical-fallback* decision
— live here so they are unit-tested without psycopg (the adapter is never imported by the
gate). This is the seam that activates §11 semantic retrieval: before spec 017 the
embedding column was never populated, so the cosine path returned nothing and grounding
silently used lexical-only matching.

constitution §5: only ``redacted_excerpt`` is ever surfaced from the DB; §6 (cost/latency):
the cosine query is ``LIMIT``-bounded so one claim can't pull an unbounded scan.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence

from release_worker.claim_models import ClaimEvidenceCandidate

# Cosine distance (``<=>``) ranks rows that HAVE an embedding by nearness to the query
# vector; ``1 - distance`` is carried as the similarity for transparency. Rows without an
# embedding are excluded — they are handled by the lexical fallback over all rows.
VECTOR_CANDIDATE_SQL = """
SELECT id, redacted_excerpt,
       1 - (embedding <=> %s::vector) AS similarity
  FROM evidence_items
 WHERE release_run_id = %s AND embedding IS NOT NULL
 ORDER BY embedding <=> %s::vector
 LIMIT %s
"""


def format_vector_literal(embedding: Sequence[float]) -> str:
    """Render a vector as the ``[f1,f2,...]`` text pgvector accepts for ``%s::vector``.

    Each component is forced through ``float`` so a stray int/str can't smuggle non-numeric
    text into the SQL parameter (the value is still bound as a parameter, never interpolated).
    """
    return "[" + ",".join(repr(float(component)) for component in embedding) + "]"


def rows_to_candidates(
    rows: Sequence[Sequence[object]],
) -> tuple[ClaimEvidenceCandidate, ...]:
    """Map cosine-query rows ``(id, redacted_excerpt, similarity)`` to candidates.

    A row with a non-null similarity is a genuine vector hit; the candidate carries it so
    the audit trail records that semantic ranking (not lexical fallback) surfaced it.
    """
    candidates: list[ClaimEvidenceCandidate] = []
    for row in rows:
        similarity = row[2] if len(row) > 2 else None
        candidates.append(
            ClaimEvidenceCandidate(
                evidence_id=str(row[0]),
                redacted_excerpt=str(row[1] or ""),
                similarity=float(similarity) if similarity is not None else None,
            )
        )
    return tuple(candidates)


def choose_candidates(
    vector_candidates: tuple[ClaimEvidenceCandidate, ...],
    lexical_fallback: Callable[[], tuple[ClaimEvidenceCandidate, ...]],
) -> tuple[ClaimEvidenceCandidate, ...]:
    """Prefer the semantic (vector) candidates; fall back to lexical when there are none.

    The fallback fires when no run evidence has an embedding yet (e.g. an older run, or the
    embedding seam was unwired) so grounding still works on lexical overlap — the AC's
    "vector path with lexical fallback". ``lexical_fallback`` is a thunk so the all-rows
    query is only run when actually needed.
    """
    if vector_candidates:
        return vector_candidates
    return lexical_fallback()
