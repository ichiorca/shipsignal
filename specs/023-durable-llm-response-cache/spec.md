# Durable LLM response cache

> PRD anchors: 2.1 Bedrock Converse model gateway (the only model path, which this caches); 5.6 resume across separate Actions invocations (the process boundary the in-memory cache fails to cross); 12.1 generate_json model contract (the call surface the cache sits in front of); 17.1 + spec 011 (token budgets / cost — a paid-for response must not be re-billed on resume/retry)
>
> No constitutional touchpoints: no new service, egress, secret, or model path. Adds one Aurora table (the constitution's mandated structured store, §4) keyed and CASCADE-scoped by `release_run_id` (§2). Stores model OUTPUT + metrics only, never a prompt or evidence (§5).

## Summary

`BedrockModelClient.generate_json` dedupes synchronous Converse calls on a caller-supplied `idempotency_key` (a deterministic content hash) using a process-local `dict` (`bedrock_client._cache`). Because each graph phase — and every resume/retry — runs in a **separate GitHub Actions job**, that cache dies with the process: a call already paid for in the initial job is re-issued and **re-billed** when the run resumes past a gate (PRD §5.6) or a transient blip retries the phase. Within a single run this is pure waste — the same redacted evidence produces the same content, the same tokens, the same cost.

This spec makes the dedup durable by adding a second cache tier in Aurora (the §4 structured store), keyed by `(release_run_id, idempotency_key)`. The process `dict` stays as an L1 read-through in front of it. A cache hit returns the previously-stored response and issues **zero** Bedrock calls and **zero** new budget/telemetry charges. The key is run-scoped so identical content in two different runs never shares a row (§2 no cross-run bleed), and every row CASCADE-deletes with its run so GDPR erasure of a run also erases its cached outputs (§5/§10). A bounded age-based sweep keeps the table from growing without limit (§6 cost/size hygiene).

## Acceptance criteria

- A new Aurora table `llm_response_cache` exists with PRIMARY KEY `(release_run_id, idempotency_key)`, a `release_run_id` FK `REFERENCES release_runs(id) ON DELETE CASCADE`, the model OUTPUT (`response JSONB`) plus dispatch metadata (`task_name`, `model_id`, `input_tokens`, `output_tokens`, `created_at`), and an index on `created_at` for the sweep. The migration contains real DDL with a clean inverse downgrade.
- The table stores model output + metrics ONLY. It never stores the system prompt, the messages, or any evidence text (constitution §5). No PII/secret column exists.
- `generate_json` is two-tier: L1 process `dict` (unchanged), then a durable L2 lookup keyed by `(release_run_id, idempotency_key)`. A miss calls Converse exactly once, meters the call (budget + telemetry, as today), and writes the response to L2; a hit at either tier returns the stored response with **zero** Converse calls and **zero** additional `meter_call` (no double-charge on resume/retry).
- Cross-process dedup holds: two `BedrockModelClient` instances (initial job + resume job) over the same `(release_run_id, idempotency_key)` issue exactly one Converse call between them.
- Cross-run isolation holds: the same `idempotency_key` under two different `release_run_id`s does **not** share a cached response (constitution §2).
- L2 is first-writer-wins: a concurrent miss on the same key (the content/claim ThreadPoolExecutor) resolves to one stored object via `INSERT ... ON CONFLICT DO NOTHING RETURNING` + fallback `SELECT`, mirroring the in-process `setdefault`.
- The durable tier is wired at every runtime `BedrockModelClient.from_env` call site that has a run id + connection (release, content, media, skill-learning, product-eval). With no connection (unit/dev), the client is L1-only and behavior is byte-identical to today.
- An env kill-switch (`LLM_RESPONSE_CACHE_DISABLED`) lets ops disable the durable tier without a deploy; default is enabled.
- An age-based sweep (`llm-cache-sweep`, window from `LLM_CACHE_TTL_DAYS`, default 30) deletes rows past the window and is reachable from an entry point (privacy CLI) and scheduled in `retention-sweep.yml`. GDPR run-erasure is already handled by the CASCADE.
- Tests: port-fake semantics (get/put, first-writer-wins, run-scoping); `generate_json` L1/L2 dedup + no-double-meter on hit; `cache=None` parity with today; sweep cutoff math; integration (real Aurora) round-trip, cross-process dedup, cross-run isolation. ≥80% coverage on changed modules; the no-infra unit gate stays green without a DB.
