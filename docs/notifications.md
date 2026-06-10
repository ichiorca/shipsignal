# Gate-ready reviewer notifications (spec 020)

T4 (spec 020) — operator-facing setup for the Slack gate-open / run-failed pings.

When a worker run halts at a human gate (Gate #1 feature manifest, Gate #2 artifacts,
Gate #3 skill candidate) or transitions to `failed`, the worker posts a **metadata-only**
message to a Slack incoming webhook: repo, `release_run_id`, gate name (or failed stage),
pending-item count, and the dashboard deep link. Never artifact content, claim text,
evidence excerpts, reviewer names, or any personal data (constitution §5 — no PII in
telemetry; the payload model is a closed field set with a denylist test).

## Prerequisites (operator-approved constitutional touchpoints)

1. **Egress allowlist** — `hooks.slack.com` is declared in `harness.cue` under
   `sandboxes.default.network.allowlist`. The current network policy is `permit`, but the
   destination is declared so tightening to `allowlist` later keeps notifications working.
2. **One new secret** — `SLACK_WEBHOOK_URL`, the Slack incoming-webhook URL. The URL
   *embeds a credential*: treat it like any other secret (constitution §5). Worker env
   only (GitHub Actions secret) — never committed, never logged, never `NEXT_PUBLIC_*`,
   never written to Aurora or the notification ledger.

Email/SES is explicitly **out of scope** for v1 (it would add an AWS service — a §7
escalation).

## Configuration

| Variable | Where | Behaviour |
|---|---|---|
| `SLACK_WEBHOOK_URL` | GitHub Actions worker env only | Unset/blank → the feature is **fully off** (the local/dev/CI default): no HTTP call, no ledger row. A non-`https://` value is treated as a misconfiguration and disables the feature with a secret-free warning. |

There is nothing to configure on the Vercel side — dispatch happens in the worker, at the
moment the gate interrupt (or failure) is observed.

## Sandbox vs prod separation

Use **separate Slack webhooks per environment** (the same posture as every other
webhook/secret pair in this project — github/bedrock/elevenlabs rules):

- **Prod**: a webhook pointing at the real reviewer channel, stored as a GitHub Actions
  *production* environment secret.
- **Sandbox/staging**: a webhook pointing at a test channel (or leave the variable unset
  to keep the feature off), stored in the corresponding non-prod environment.

Never reuse the prod webhook in a sandbox — a test run would ping real reviewers, and a
leaked sandbox config would expose a credential that reaches the production channel.

## Idempotency and failure behaviour

- Deliveries are recorded in the `gate_notifications` table (migration 0020), keyed
  UNIQUE on `(release_run_id, gate)`: a resumed/replayed graph that re-raises the same
  interrupt does **not** re-ping; redelivery after a transient HTTP failure (429/5xx)
  reuses the row with a bounded, jittered backoff and an attempt-count trail.
- Notification failure **never fails the run**: dispatch errors are caught narrowly,
  recorded on the ledger row, and the gate interrupt proceeds normally.
- `notified_at` on the ledger row anchors the "time to notice" vs "time to decide"
  latency split shown on `/releases/[id]/evals` (spec 020 T5).
