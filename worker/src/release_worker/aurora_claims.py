"""T3/T5 (spec 006) — runtime Aurora adapters for the claim/check/Gate-2 nodes.

P4 (Storage): artifact claims, claim-evidence links, and the candidate evidence the matcher
ranks all live in Aurora. aurora-rules: every statement is parameterised; the connection is
the shared short-lived job connection. Imported only by ``__main__`` at runtime (needs
psycopg), so the unit gate never imports it — the nodes are tested against the in-memory fakes.

constitution §5: ``AuroraEvidenceMatcher`` surfaces only ``redacted_excerpt`` (there is no
raw column), so claim grounding never sees raw text; ``AuroraClaimSink`` writes the §10.3
provenance the Gate #2 audit trail depends on.
"""

from __future__ import annotations

import json
from collections.abc import Callable

import psycopg

from release_worker.claim_models import (
    ArtifactClaim,
    ClaimEvidenceCandidate,
    ClaimEvidenceLink,
)
from release_worker.vector_retrieval import (
    VECTOR_CANDIDATE_SQL,
    choose_candidates,
    format_vector_literal,
    rows_to_candidates,
)

# Bound the candidate set the matcher returns so one claim can't pull an unbounded scan into
# the deterministic scorer (constitution §6 cost/latency).
_DEFAULT_TOP_K = 50


class AuroraEvidenceMatcher:
    """Surface a run's redacted evidence as claim-grounding candidates (PRD §11).

    Scoped to one ``release_run_id`` (no cross-run bleed, constitution §2). When an
    ``embed_claim`` callable is injected, candidates are pgvector-ranked by cosine distance to
    the claim embedding (``embedding <=> %s::vector``) over rows that have an embedding;
    otherwise every run evidence item is returned and the node's deterministic lexical score
    is the sole (and binding) grounding signal. Either way only ``redacted_excerpt`` leaves
    the DB (§5).
    """

    def __init__(
        self,
        conn: psycopg.Connection,
        release_run_id: str,
        embed_claim: Callable[[str], list[float]] | None = None,
        top_k: int = _DEFAULT_TOP_K,
    ) -> None:
        self._conn = conn
        self._release_run_id = release_run_id
        self._embed_claim = embed_claim
        self._top_k = top_k

    def candidates_for_claim(
        self, claim_text: str
    ) -> tuple[ClaimEvidenceCandidate, ...]:
        # T3 (spec 017): when an embedding seam is wired, rank by pgvector cosine distance
        # and fall back to the all-rows lexical set only when the run has no embedded rows
        # (the "vector path with lexical fallback" AC). Without a seam, lexical is the sole
        # path. Either way only ``redacted_excerpt`` leaves the DB (§5).
        if self._embed_claim is None:
            return self._all_candidates()
        return choose_candidates(
            self._pgvector_candidates(claim_text), self._all_candidates
        )

    def _pgvector_candidates(
        self, claim_text: str
    ) -> tuple[ClaimEvidenceCandidate, ...]:
        """Top-K evidence ranked by pgvector cosine distance to the claim embedding.

        ``1 - (embedding <=> %s)`` is the cosine similarity carried for transparency; the
        node still applies the deterministic lexical score on top before grounding. Returns
        empty when no run evidence carries an embedding — the caller then falls back to the
        lexical all-rows set."""
        if self._embed_claim is None:  # pragma: no cover - guarded by the caller
            return ()
        vector_literal = format_vector_literal(self._embed_claim(claim_text))
        with self._conn.cursor() as cur:
            cur.execute(
                VECTOR_CANDIDATE_SQL,
                (vector_literal, self._release_run_id, vector_literal, self._top_k),
            )
            rows = cur.fetchall()
        return rows_to_candidates(rows)

    def _all_candidates(self) -> tuple[ClaimEvidenceCandidate, ...]:
        """Every redacted evidence item for the run (no semantic ranking available)."""
        with self._conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, redacted_excerpt
                  FROM evidence_items
                 WHERE release_run_id = %s
                 ORDER BY id
                 LIMIT %s
                """,
                (self._release_run_id, self._top_k),
            )
            rows = cur.fetchall()
        return tuple(
            ClaimEvidenceCandidate(
                evidence_id=str(row[0]), redacted_excerpt=row[1] or ""
            )
            for row in rows
        )


class AuroraClaimSink:
    """Persist artifact_claims + claim_evidence_links rows (PRD §10.3)."""

    def __init__(self, conn: psycopg.Connection) -> None:
        self._conn = conn

    def insert_claim(self, record: ArtifactClaim) -> None:
        with self._conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO artifact_claims (
                    id, artifact_id, claim_text, claim_type, support_status,
                    risk_level, checker_metadata_json
                ) VALUES (%s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    record.claim_id,
                    record.artifact_id,
                    record.claim_text,
                    record.claim_type,
                    record.support_status,
                    record.risk_level,
                    json.dumps(record.checker_metadata),
                ),
            )

    def link_evidence(self, link: ClaimEvidenceLink) -> None:
        with self._conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO claim_evidence_links (claim_id, evidence_item_id, support_score)
                VALUES (%s, %s, %s)
                ON CONFLICT (claim_id, evidence_item_id) DO NOTHING
                """,
                (link.claim_id, link.evidence_item_id, link.support_score),
            )


class AuroraArtifactReviewSink:
    """Apply a Gate #2 rejected/edited status to an artifact row (PRD §10.3)."""

    def __init__(self, conn: psycopg.Connection) -> None:
        self._conn = conn

    def update_artifact_status(self, artifact_id: str, status: str) -> None:
        # Fail-closed against approval: this path only ever applies rejected/edited from the
        # graph (the route keeps 'approved' out), and a blocked artifact is never advanced to
        # 'approved' here (constitution §5). The human approval + notes are the dashboard
        # API's job (recorded in the approvals row; artifacts has no notes column, §10.3).
        with self._conn.cursor() as cur:
            cur.execute(
                """
                UPDATE artifacts
                   SET status = %s,
                       updated_at = now()
                 WHERE id = %s
                """,
                (status, artifact_id),
            )
