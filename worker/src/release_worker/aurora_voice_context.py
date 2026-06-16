"""Runtime ``VoiceContextSource`` over Aurora + Bedrock (migration 0025).

Retrieves the brand/customer grounding for a generation: the company's own voice exemplars ranked
by semantic similarity to what changed (pgvector cosine, mirrors the §11 evidence retrieval), the
approved messaging claims, and the active ICP segments. Also embeds newly-added exemplars (Bedrock)
— model calls run here on the worker, never the Vercel app (constitution §1). Imported only by
``__main__`` at runtime (needs psycopg + the embedder), so the unit gate exercises generation
against ``InMemoryVoiceContextSource`` instead.
"""

from __future__ import annotations

import psycopg

from release_worker.embedding_ports import EmbeddingClient
from release_worker.vector_retrieval import format_vector_literal
from release_worker.voice_context import (
    IcpSegment,
    MessagingClaim,
    VoiceContext,
    VoiceExemplar,
)

_MESSAGING_LIMIT = 20


class AuroraVoiceContextSource:
    """Embed-on-demand + pgvector retrieval for the brand brain."""

    def __init__(self, conn: psycopg.Connection, embedder: EmbeddingClient) -> None:
        self._conn = conn
        self._embedder = embedder

    def embed_pending(self) -> int:
        """Embed every exemplar whose vector is not yet populated (e.g. just added in /settings).
        Returns the number embedded. Idempotent: an already-embedded row is skipped."""
        with self._conn.cursor() as cur:
            cur.execute(
                "SELECT id, body_text FROM company_voice_exemplars WHERE embedding IS NULL"
            )
            pending = cur.fetchall()
        for exemplar_id, body_text in pending:
            literal = format_vector_literal(tuple(self._embedder.embed(body_text)))
            with self._conn.cursor() as cur:
                cur.execute(
                    "UPDATE company_voice_exemplars SET embedding = %s::vector WHERE id = %s",
                    (literal, exemplar_id),
                )
        return len(pending)

    def retrieve(
        self, query_text: str, channel: str | None = None, top_k: int = 3
    ) -> VoiceContext:
        return VoiceContext(
            exemplars=self._retrieve_exemplars(query_text, channel, top_k),
            claims=self._approved_claims(),
            segments=self._active_segments(),
        )

    def _retrieve_exemplars(
        self, query_text: str, channel: str | None, top_k: int
    ) -> tuple[VoiceExemplar, ...]:
        literal = format_vector_literal(tuple(self._embedder.embed(query_text)))
        with self._conn.cursor() as cur:
            if channel is not None:
                cur.execute(
                    """
                    SELECT id, title, body_text, channel, source
                      FROM company_voice_exemplars
                     WHERE embedding IS NOT NULL AND (channel = %s OR channel = 'any')
                     ORDER BY embedding <=> %s::vector
                     LIMIT %s
                    """,
                    (channel, literal, top_k),
                )
            else:
                cur.execute(
                    """
                    SELECT id, title, body_text, channel, source
                      FROM company_voice_exemplars
                     WHERE embedding IS NOT NULL
                     ORDER BY embedding <=> %s::vector
                     LIMIT %s
                    """,
                    (literal, top_k),
                )
            rows = cur.fetchall()
        return tuple(
            VoiceExemplar(
                id=str(row[0]),
                title=row[1] or "",
                body_text=row[2],
                channel=row[3],
                source=row[4],
            )
            for row in rows
        )

    def _approved_claims(self) -> tuple[MessagingClaim, ...]:
        with self._conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, claim_text, claim_type, evidence_url
                  FROM messaging_claims
                 WHERE status = 'approved'
                 ORDER BY created_at DESC
                 LIMIT %s
                """,
                (_MESSAGING_LIMIT,),
            )
            rows = cur.fetchall()
        return tuple(
            MessagingClaim(
                id=str(row[0]),
                claim_text=row[1],
                claim_type=row[2],
                evidence_url=row[3],
            )
            for row in rows
        )

    def _active_segments(self) -> tuple[IcpSegment, ...]:
        with self._conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, name, description, pain_points, objections, approved_angles
                  FROM icp_segments
                 WHERE status = 'active'
                 ORDER BY name
                """
            )
            rows = cur.fetchall()
        return tuple(
            IcpSegment(
                id=row[0],
                name=row[1],
                description=row[2] or "",
                pain_points=tuple(row[3] or ()),
                objections=tuple(row[4] or ()),
                approved_angles=tuple(row[5] or ()),
            )
            for row in rows
        )
