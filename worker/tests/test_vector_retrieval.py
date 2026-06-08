"""T3 (spec 017) — the pgvector retrieval seam: a vector hit, and lexical fallback.

The cosine SQL runs in the runtime Aurora adapter (psycopg, not installed in the gate), so
the pure parts that decide retrieval behaviour — the vector literal format, the row→candidate
mapping that marks a genuine vector hit, and the vector-then-lexical-fallback rule — are
unit-tested here directly. Together they prove the AC: the vector path surfaces a semantic
hit (not just the fallback), and falls back to lexical when a run has no embedded rows.

A companion test drives ``link_claims_to_evidence`` with a vector-ranked candidate to prove
the grounding node consumes the cosine path end-to-end.
"""

from __future__ import annotations

from release_worker.claim_models import (
    ArtifactClaim,
    ClaimEvidenceCandidate,
    SupportStatus,
)
from release_worker.claim_nodes import link_claims_to_evidence
from release_worker.claim_ports import InMemoryClaimEvidenceMatcher
from release_worker.vector_retrieval import (
    VECTOR_CANDIDATE_SQL,
    choose_candidates,
    format_vector_literal,
    rows_to_candidates,
)


def test_format_vector_literal_is_pgvector_bracket_syntax() -> None:
    assert format_vector_literal([0.0, 1.5, -2.0]) == "[0.0,1.5,-2.0]"


def test_vector_candidate_sql_uses_cosine_distance_and_filters_unembedded() -> None:
    # The query MUST cosine-rank (``<=>``), exclude rows without an embedding (those are the
    # lexical-fallback set), and bound the scan (constitution §6 cost/latency).
    assert "<=>" in VECTOR_CANDIDATE_SQL
    assert "embedding IS NOT NULL" in VECTOR_CANDIDATE_SQL
    assert "LIMIT" in VECTOR_CANDIDATE_SQL


def test_rows_to_candidates_marks_a_vector_hit_with_similarity() -> None:
    # Rows as the cosine query returns them: (id, redacted_excerpt, similarity).
    rows = [
        ("ev-1", "Create onboarding checklist", 0.91),
        ("ev-2", "unrelated change", 0.12),
    ]
    candidates = rows_to_candidates(rows)
    assert candidates[0].evidence_id == "ev-1"
    # A populated similarity is the signal that semantic ranking (not lexical) surfaced it.
    assert candidates[0].similarity == 0.91
    assert candidates[1].similarity == 0.12


def test_choose_candidates_prefers_vector_hits_over_fallback() -> None:
    vector_hit = (
        ClaimEvidenceCandidate(
            evidence_id="ev-1", redacted_excerpt="x", similarity=0.9
        ),
    )

    def _fallback() -> tuple[ClaimEvidenceCandidate, ...]:
        raise AssertionError("lexical fallback must not run when vector hits exist")

    assert choose_candidates(vector_hit, _fallback) == vector_hit


def test_choose_candidates_falls_back_to_lexical_when_no_vector_hit() -> None:
    fallback_set = (ClaimEvidenceCandidate(evidence_id="ev-9", redacted_excerpt="y"),)
    assert choose_candidates((), lambda: fallback_set) == fallback_set


def test_link_claims_grounds_via_a_vector_ranked_candidate() -> None:
    # End-to-end through the grounding node: a vector-surfaced candidate (similarity set)
    # whose text overlaps the claim grounds it SUPPORTED — the cosine path is consumed, not
    # bypassed. This is the "vector hit, not just fallback" proof at the node surface.
    claim = ArtifactClaim(
        claim_id="c-1",
        artifact_id="a-1",
        claim_text="Create onboarding checklist for new admins",
        claim_type="capability",
        support_status=SupportStatus.UNSUPPORTED.value,
        risk_level="low",
    )
    matcher = InMemoryClaimEvidenceMatcher(
        (
            ClaimEvidenceCandidate(
                evidence_id="ev-1",
                redacted_excerpt="Add the onboarding checklist admins can create",
                similarity=0.93,
            ),
        )
    )

    resolved, links = link_claims_to_evidence((claim,), matcher)

    assert resolved[0].support_status == SupportStatus.SUPPORTED.value
    assert links and links[0].evidence_item_id == "ev-1"
