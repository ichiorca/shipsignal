"""llm_response_cache — durable cross-invocation LLM dedup cache

Revision ID: 0034_llm_response_cache
Revises: 0033_voice_guide
Create Date: 2026-06-23

T1 (spec 023) — the worker dedupes synchronous Bedrock Converse calls on a caller-supplied
``idempotency_key`` (a deterministic content hash), but that cache was process-local
(``bedrock_client._cache``). Each graph phase — and every resume/retry — runs in a SEPARATE
GitHub Actions job, so a call already paid for in the initial job was re-issued and re-billed
when the run resumed past a gate (PRD §5.6) or a transient blip retried the phase. This table
makes the dedup durable across that process boundary.

Scope (constitution §2): keyed by ``(release_run_id, idempotency_key)``. The run id is part
of the key so identical content in two DIFFERENT runs never shares a cached response — no
cross-run bleed, and token budget/telemetry stay attributable per run. The ``release_run_id``
FK CASCADE-deletes the cached outputs with their run, so GDPR erasure of a run (spec 010)
clears this table for free (§5/§10) — no separate erasure path.

P5 (Safety rails) / constitution §5: the row stores the model OUTPUT only (``response`` —
already past Guardrails, no more sensitive than the ``artifacts`` table it lands in) plus
dispatch METADATA (task_name, model_id, token counts). NEVER the system prompt, the messages,
or any evidence excerpt — persisting them would widen the surface for no benefit ("don't log
prompts/outputs"). This mirrors ``model_call_telemetry`` (0011) and ``gate_notifications``
(0020): metrics + provenance, never content the model read.

Real DDL — not a stub (anti-pattern #1); the downgrade is a clean inverse.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0034_llm_response_cache"
down_revision: str | None = "0033_voice_guide"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # One row per (run, idempotency_key). The PK is the dedup key the worker checks before
    # a Converse call; ON CONFLICT DO NOTHING on it gives cross-process first-writer-wins.
    op.execute(
        """
        CREATE TABLE llm_response_cache (
            release_run_id   UUID NOT NULL
                               REFERENCES release_runs(id) ON DELETE CASCADE,
            idempotency_key  TEXT NOT NULL,
            task_name        TEXT NOT NULL,
            model_id         TEXT NOT NULL,
            response         JSONB NOT NULL,
            input_tokens     INTEGER NOT NULL DEFAULT 0,
            output_tokens    INTEGER NOT NULL DEFAULT 0,
            created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
            PRIMARY KEY (release_run_id, idempotency_key)
        );
        """
    )
    # The §6 size-hygiene sweep (`llm-cache-sweep`) deletes by age; index the predicate so a
    # daily sweep doesn't seq-scan the table.
    op.execute(
        "CREATE INDEX ix_llm_response_cache_created_at "
        "ON llm_response_cache (created_at);"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_llm_response_cache_created_at;")
    op.execute("DROP TABLE IF EXISTS llm_response_cache;")
