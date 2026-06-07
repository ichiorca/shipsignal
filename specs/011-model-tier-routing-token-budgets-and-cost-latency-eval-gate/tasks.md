# Tasks — Model-tier routing, token budgets, and cost/latency eval gate

- [ ] **T1 — Per-node model-tier routing** Introduce a routing config mapping each graph node to a model tier with documented rationale; default to the cheapest tier that meets quality.
- [ ] **T2 — Token-budget enforcement** Enforce per-node/per-run token budgets with backoff on Bedrock throttling; surface budget overruns as failures.
- [ ] **T3 — Cost/latency telemetry in Aurora** Persist per-call tokens/latency/model_id/cost estimate to Aurora telemetry tables, scoped by release_run_id.
- [ ] **T4 — Cost-quality eval gate** Add an eval gate that fails CI if cost/latency exceeds budget or an untracked tier change is detected.
- [ ] **T5 — Dashboard cost view** Per-run cost/latency breakdown by node/model; keyboard-operable, WCAG 2.2 AA.
