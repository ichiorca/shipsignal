# Tasks — Gate-ready reviewer notifications

- [x] **T1 — Notifier module + ledger** Worker-side notifier (stdlib urllib, async-safe) plus `gate_notifications` migration and Aurora adapter; idempotency on (release_run_id, gate); bounded retry with backoff.
- [x] **T2 — Wire to interrupts + failure path** Dispatch at all three gate interrupts and on run failure; payload built from the existing §5.6 interrupt payload (it already has counts + dashboard_url).
- [x] **T3 — Metadata-only guarantee** Pydantic payload model with a closed field set; test asserting no content/PII fields can appear; lazy %-style logging with no payload bodies.
- [x] **T4 — Config + docs** `SLACK_WEBHOOK_URL` from env with fail-soft when unset; docs covering the egress-allowlist/secret prerequisites and sandbox-vs-prod webhook separation.
- [x] **T5 — Latency attribution** Record `notified_at`; extend the eval metrics read path and `/releases/[id]/evals` to show notify→decision latency next to approval latency; a11y-clean rendering.
