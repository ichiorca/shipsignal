# Plan — Durable LLM response cache

(architecture / approach honoring the constitution)

## Why a second tier, not a replacement

The process `dict` (`bedrock_client._cache`) is kept as **L1**: it dedupes the concurrent
ThreadPoolExecutor callers within one process with no DB round-trip, and it is the only tier
on the unit/dev path (no connection). The Aurora table is **L2**: it survives the process
boundary that the in-memory tier cannot — the separate Actions job that resumes a gate (PRD
§5.6) or the retry that re-enters a phase. The win is *persistence*, not latency, which is
exactly why this belongs in Aurora (constitution §4, the mandated structured store) and not
in a new in-memory service — sub-millisecond reads buy nothing when the unit of work is a
multi-second Converse call on a batch runner.

## The load-bearing decision: key by (release_run_id, idempotency_key)

`idempotency_key` is a deterministic content hash, so two *different* runs over identical
content would collide on it. Sharing one cached response across runs would (a) violate §2
("cross-run data bleed is forbidden") and (b) mis-attribute token budget/telemetry — run B
would silently ride run A's paid call. So `release_run_id` is part of the key. Consequences,
all intended:

- Dedup target is "same run, across resume/retry/concurrent-miss" — never cross-run.
- The FK + `ON DELETE CASCADE` means GDPR run-erasure (spec 010) clears cached outputs for
  free; no separate erasure path to maintain (§5/§10).
- Budget/telemetry stay attributable per run.

This mirrors the precedent set by `gate_notifications` (migration 0020) and
`model_call_telemetry` (migration 0011): every row carries `release_run_id`, CASCADE-scoped.

## What is stored — and what is not (§5)

Stored: the model **output** (`response JSONB`, already past Guardrails — no more sensitive
than the `artifacts` table it ends up in anyway) plus dispatch **metadata** (`task_name`,
`model_id`, token counts, `created_at`). **Not** stored: the system prompt, the messages, or
any evidence excerpt — persisting them would widen the surface for zero benefit, the same
"metadata + safe payload only" discipline `aurora_cost`/`aurora_notifications` follow.

## Budget/telemetry on a hit

A hit at L1 or L2 returns early and is **not** re-metered: the call was charged once on the
original miss; re-charging on resume would double-count cost against the §11 budget. Trade-off:
the resume job's telemetry won't carry a row for that call. We persist `input_tokens` /
`output_tokens` / `model_id` so a future "emit a `cached=true`, cost=0 telemetry row" is a
pure additive change — deliberately out of scope for this spec to avoid scope creep.

## Concurrency / threading

The content and claim graphs call `generate_json` from a `ThreadPoolExecutor`. The L1 lock
(`_cache_lock`) is unchanged. L2 writes use `INSERT ... ON CONFLICT (release_run_id,
idempotency_key) DO NOTHING RETURNING response`, falling back to a `SELECT` on conflict — the
cross-process equivalent of the existing in-process `setdefault`, so one key always resolves
to one object. The adapter takes a single `psycopg.Connection` (psycopg3 connections serialize
concurrent use under an internal lock — the same single-conn pattern every other `Aurora*`
adapter in this worker uses, e.g. `AuroraCostTelemetrySink`); no new pool dependency. The
Actions `concurrency:` group already serializes same-(run, graph) jobs, so real cross-process
contention is rare — the ON CONFLICT keeps it correct regardless.

## Seam shape (mirrors the ModelClient port)

- Pure port `LlmResponseCache` (Protocol) + `InMemoryLlmResponseCache` fake live in
  `model_client.py` (no psycopg/boto3), so the unit gate exercises the contract and the
  `generate_json` L1/L2 logic against fakes — no DB, no AWS.
- Runtime adapter `AuroraLlmResponseCache` (psycopg) lives in its own module imported only by
  `__main__`, integration-tested against the real local stack — the same split as every
  `aurora_*.py` adapter.

## Retention (§6)

CASCADE covers erasure. For unbounded-growth hygiene, an age-based sweep (`delete_older_than`)
is exposed as a new `llm-cache-sweep` subcommand on the existing privacy CLI (already the home
of scheduled data-lifecycle sweeps and already invoked by `retention-sweep.yml`), with the
window from `LLM_CACHE_TTL_DAYS` (default 30). The cutoff is a pure function so the unit gate
tests it without a clock or DB. A second step is added to `retention-sweep.yml`.

## Reachability / kill-switch

The adapter is injected at all five runtime `from_env` sites that own a `(run_id, conn)`. A
miss path with `cache=None` (unit/dev) is byte-identical to today. `LLM_RESPONSE_CACHE_DISABLED`
read in `from_env` lets ops drop to L1-only without a deploy.
