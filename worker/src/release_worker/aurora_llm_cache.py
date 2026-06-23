"""T2/T4 (spec 023) — runtime Aurora adapter for the durable LLM response cache.

P4 (Storage) + aurora-postgresql-rules: the pure ``LlmResponseCache`` Protocol (model_client)
is the seam ``BedrockModelClient`` depends on; this psycopg implementation is the durable L2
tier over ``llm_response_cache`` (migration 0034), imported only by ``__main__`` so the unit
gate never needs a DB. Every statement is parameterised and keyed by the composite PK
``(release_run_id, idempotency_key)`` — the run id is part of the key so a cache hit can never
cross runs (constitution §2).

Idempotent writes (aurora rules): ``put`` is ``INSERT ... ON CONFLICT DO NOTHING RETURNING``
with a fallback ``SELECT`` on conflict, so a concurrent miss on the same key (the content/claim
ThreadPoolExecutor) resolves to ONE stored object — the cross-process equivalent of the
in-process ``setdefault``.

P5 (Safety rails) / constitution §5: only the model OUTPUT (``response``) and dispatch
metadata (task_name, model_id, token counts) are written — never the prompt, the messages, or
any evidence excerpt.
"""

from __future__ import annotations

import json
from datetime import datetime

import psycopg


class AuroraLlmResponseCache:
    """``LlmResponseCache`` over the Aurora ``llm_response_cache`` table (migration 0034)."""

    def __init__(self, conn: psycopg.Connection) -> None:
        self._conn = conn

    def get(
        self, release_run_id: str, idempotency_key: str
    ) -> dict[str, object] | None:
        with self._conn.cursor() as cur:
            cur.execute(
                """
                SELECT response FROM llm_response_cache
                 WHERE release_run_id = %s AND idempotency_key = %s
                """,
                (release_run_id, idempotency_key),
            )
            row = cur.fetchone()
        # psycopg3 decodes JSONB to a Python object; the column is NOT NULL so a present row
        # always carries a dict (it was written from a dict by ``put``).
        return row[0] if row is not None else None

    def put(
        self,
        release_run_id: str,
        idempotency_key: str,
        *,
        task_name: str,
        model_id: str,
        response: dict[str, object],
        input_tokens: int,
        output_tokens: int,
    ) -> dict[str, object]:
        with self._conn.cursor() as cur:
            # First writer wins. RETURNING is empty when the row already existed, so on a
            # conflict we re-read the authoritative value — one key => one object.
            cur.execute(
                """
                INSERT INTO llm_response_cache
                    (release_run_id, idempotency_key, task_name, model_id,
                     response, input_tokens, output_tokens)
                VALUES (%s, %s, %s, %s, %s::jsonb, %s, %s)
                ON CONFLICT (release_run_id, idempotency_key) DO NOTHING
                RETURNING response
                """,
                (
                    release_run_id,
                    idempotency_key,
                    task_name,
                    model_id,
                    json.dumps(response),
                    input_tokens,
                    output_tokens,
                ),
            )
            inserted = cur.fetchone()
            if inserted is not None:
                return inserted[0]
            cur.execute(
                """
                SELECT response FROM llm_response_cache
                 WHERE release_run_id = %s AND idempotency_key = %s
                """,
                (release_run_id, idempotency_key),
            )
            existing = cur.fetchone()
        # A racing writer committed between our INSERT and SELECT only if it used a separate
        # connection; on one connection the row is visible. Fall back to the value we tried
        # to store so the caller always gets a dict.
        return existing[0] if existing is not None else response

    def delete_older_than(self, cutoff: datetime) -> int:
        """T4 — delete cache rows created before ``cutoff`` (size hygiene, constitution §6).

        Returns the number of rows deleted. GDPR run-erasure is handled separately by the
        ``release_run_id`` FK CASCADE; this is purely about bounding table growth.
        """
        with self._conn.cursor() as cur:
            cur.execute(
                "DELETE FROM llm_response_cache WHERE created_at < %s",
                (cutoff,),
            )
            return cur.rowcount
