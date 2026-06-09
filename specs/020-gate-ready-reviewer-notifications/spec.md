# Gate-ready reviewer notifications

> PRD anchors: 5.6 (gate interrupts already surface a JSON payload with `dashboard_url` — this spec delivers that payload to a human instead of letting it sit); 13.2 release status model (`features_pending_review`, `artifacts_pending_review`); 13.3 skill candidate `pending_review`; 17.1 approval-latency metric (the metric this spec exists to reduce)
>
> Operator-approved constitutional touchpoints: (1) Slack incoming-webhook URL is a new network-egress destination — add to the harness egress allowlist; (2) one new secret (`SLACK_WEBHOOK_URL`). Email/SES is explicitly OUT of scope for v1 — it would add an AWS service (§7 escalation) for marginal gain.

## Summary

All three approval gates are hard LangGraph interrupts, and approval latency is a tracked product metric — but no human is told a gate opened. A run can sit in `features_pending_review` for days because nobody looked at the dashboard. This spec adds a notification dispatch in the worker: when a gate interrupt fires (Gate #1 feature manifest, Gate #2 artifacts, Gate #3 skill candidate) or a run fails, post a metadata-only message to a Slack incoming webhook with a deep link to the relevant review page. Messages carry counts and identifiers only — never artifact content, evidence excerpts, or personal data — so nothing redaction-sensitive leaves the system. Idempotent per (release_run_id, gate) so resumed/replayed graphs don't re-ping.

## Acceptance criteria

- When the worker raises a gate interrupt for Gate #1, #2, or #3, and when a run transitions to `failed`, a notification is posted to `SLACK_WEBHOOK_URL` containing: repo, release_run_id, gate name (or failure stage), pending-item count, and the dashboard deep link (`/releases/{id}/review`, `/releases/{id}/artifacts/review`, `/releases/{id}/skills/review`).
- Payloads are metadata-only: no artifact body, no claim text, no evidence excerpts, no reviewer names, no PII (constitution §5 — no PII in telemetry; a test asserts the payload shape against a denylist of content fields).
- Notifications are idempotent: a `gate_notifications` ledger (Aurora, keyed by release_run_id + gate) ensures resume/replay of the same interrupt does not re-send; redelivery after transient HTTP failure reuses the ledger row with attempt count + backoff.
- Notification failure never fails the run: dispatch errors are caught narrowly, recorded on the ledger row, and the interrupt proceeds normally (graceful degradation, same pattern as broken media steps).
- Feature is fully off when `SLACK_WEBHOOK_URL` is unset (local/dev/CI default); the secret comes from worker env only and is never logged or persisted.
- `notified_at` is recorded per gate and surfaced alongside approval latency on `/releases/[id]/evals`, so latency can be split into "time to notice" vs "time to decide".
- Tests: idempotency on replay, payload denylist, failure-isolation (webhook 500 does not break the interrupt), unset-config no-op, and the evals-page latency split.
