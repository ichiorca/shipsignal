# Model-tier routing, token budgets, and cost/latency eval gate

> PRD anchors: 2.1 Keep (Bedrock Converse model gateway); 6. Quality bars (Cost/latency); 5. LangGraph Design (retries/routing)

## Summary

Bring the LLM pipeline under explicit cost/latency governance: model-tier routing per node, token budgets, telemetry persisted in Aurora, a cost-quality eval gate, and a dashboard cost view — so no untracked model-tier upgrade can slip in.

## Acceptance criteria

- Each node uses its configured model tier; a tier change without config update is detected and fails the gate.
- Per-run token/latency/cost telemetry is persisted in Aurora and scoped by release_run_id.
- Exceeding the token/latency budget fails the eval gate rather than silently proceeding.
- Cost dashboard renders per-node breakdown and meets WCAG 2.2 AA.
- Throttling is handled with backoff; no PII or prompt content stored in cost telemetry.
