"""T2 (spec 017) — evidence embeddings are computed and attached on persist.

Exercises ``persist_evidence`` / ``collect_redact_persist_all`` through the exact surface
the graph node wraps (anti-pattern #4), against the in-memory evidence sink + the
deterministic ``HashingEmbeddingClient`` fake. Proves the AC: embeddings are computed via
the embedding seam and carried onto the persisted row, only from the redacted excerpt
(constitution §5), and that with no seam the embedding stays ``None`` (lexical fallback).
"""

from __future__ import annotations

from release_worker.embedding_ports import EMBEDDING_DIMS, HashingEmbeddingClient
from release_worker.evidence_models import RedactedEvidence
from release_worker.evidence_nodes import persist_evidence
from release_worker.evidence_ports import InMemoryEvidenceSink

_RUN_ID = "11111111-1111-4111-8111-111111111111"


def _redacted() -> tuple[RedactedEvidence, ...]:
    return (
        RedactedEvidence(
            evidence_type="ui_string_change",
            source="git_diff",
            repo="org/product",
            redacted_excerpt="Add button: Create onboarding checklist",
        ),
        RedactedEvidence(
            evidence_type="issue",
            source="issue_tracker",
            repo="org/product",
            redacted_excerpt="As an admin I want reusable onboarding checklists",
        ),
    )


def test_persist_computes_embedding_from_redacted_excerpt() -> None:
    sink = InMemoryEvidenceSink()
    embedder = HashingEmbeddingClient()

    records = persist_evidence(_RUN_ID, _redacted(), sink, embedder)

    # Every persisted row carries a full-dimensionality vector matching the column.
    for record in records:
        assert record.embedding is not None
        assert len(record.embedding) == EMBEDDING_DIMS
    # The embedding is the embedding of the REDACTED excerpt (the seam is post-redaction, §5):
    # recomputing it from the row's redacted text reproduces the stored vector exactly.
    first = records[0]
    assert list(first.embedding) == embedder.embed(first.redacted_excerpt)


def test_persist_without_embedder_leaves_embedding_none() -> None:
    # No seam wired ⇒ embedding stays None so downstream retrieval falls back to lexical
    # (no regression for runs/environments without the embedding model).
    records = persist_evidence(_RUN_ID, _redacted(), InMemoryEvidenceSink())
    assert all(record.embedding is None for record in records)


def test_distinct_excerpts_get_distinct_embeddings() -> None:
    # A meaningful embedding must vary with content — two different excerpts must not collapse
    # to the same vector (else the cosine path could never distinguish candidates).
    records = persist_evidence(
        _RUN_ID, _redacted(), InMemoryEvidenceSink(), HashingEmbeddingClient()
    )
    assert records[0].embedding != records[1].embedding
