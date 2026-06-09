# Approved-artifact export and distribution (spec 019)

How approved content leaves ShipSignal. Everything here operates strictly **after Gate #2**:
only artifacts a human approved — and only their immutable approved snapshots (§18.1
"publishable truth"), never the editable working rows — are exportable or distributable.

## Export API

| Endpoint | Returns |
|---|---|
| `GET /api/artifacts/{artifactId}/export?format=markdown` | The approved markdown (default format) |
| `GET /api/artifacts/{artifactId}/export?format=html` | A standalone, escaped HTML document |
| `GET /api/artifacts/{artifactId}/export?format=json` | The provenance record: content hash, claim support, evidence ids, model/prompt/skill versions, approval id |
| `GET /api/releases/{releaseRunId}/artifacts/export` | JSON bundle of every approved artifact in the run |

- A non-approved artifact (draft / blocked / edited / rejected) returns **409** — there is no
  approved content to export. An unknown artifact returns **404**.
- Responses set `Content-Disposition: attachment`, so the dashboard's Download links save files
  directly. The review page (Gate #2) and the claim inspector show **Copy Markdown** +
  download actions on approved artifacts.
- Exports never include the reviewer's name (data minimization); the `approval_id` in the JSON
  record is the internal audit reference.

## Outbound webhook (`artifact.approved`)

When configured, ShipSignal POSTs the approved content to one consumer endpoint at each
artifact approval, plus a run-level sweep when Gate #2 resolves "Approve & resume" (covering
any artifact whose earlier dispatch failed).

### Prerequisites (operator)

1. **Egress allowlist** — the consumer host must be permitted by the harness guardrails
   (constitution §5 blast radius). This was operator-approved with spec 019.
2. **Secrets** (server env only — GitHub/Vercel env; never `NEXT_PUBLIC_*`, never committed):
   - `OUTBOUND_WEBHOOK_URL` — the consumer endpoint. Unset ⇒ the feature is entirely off.
   - `OUTBOUND_WEBHOOK_SECRET` — HMAC signing key. A URL without a secret fails fast; nothing
     is ever sent unsigned. Use distinct secrets per environment (sandbox vs prod).

### Request shape

```
POST <OUTBOUND_WEBHOOK_URL>
Content-Type: application/json
x-shipsignal-delivery:  <delivery id — stable across redeliveries>
x-shipsignal-timestamp: <unix seconds>
x-shipsignal-signature: sha256=<hex HMAC-SHA256 over `${timestamp}.${rawBody}`>
```

Payload (assembled from the approved snapshot only; no reviewer identity, no evidence
excerpts, no secrets):

```json
{
  "event": "artifact.approved",
  "delivery_id": "…",
  "release_run_id": "…",
  "artifact_id": "…",
  "artifact_type": "release_blog",
  "final_title": "…",
  "final_body_markdown": "…",
  "content_hash": "…",
  "approved_at": "2026-06-09T00:00:00.000Z"
}
```

### Verifying (consumer side)

Compute HMAC-SHA256 with the shared secret over the **raw request body** prefixed by the
timestamp header — `${timestamp}.${rawBody}` — and compare (constant-time) against
`x-shipsignal-signature`. Reject when the signature mismatches or the timestamp is outside
your tolerance window (replay bound). Node example:

```js
import { createHmac, timingSafeEqual } from 'node:crypto';

function verify(secret, timestampHeader, rawBody, signatureHeader) {
  const expected = `sha256=${createHmac('sha256', secret)
    .update(`${timestampHeader}.${rawBody}`)
    .digest('hex')}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  return a.length === b.length && timingSafeEqual(a, b);
}
```

### Delivery semantics

- **At-least-once.** Dedupe on `delivery_id` (also in the payload): it is deterministic per
  `(event, artifact)`, so a redelivery after a transient failure reuses the same id.
- **Retries:** up to 3 attempts with exponential backoff on 5xx/429 or network failure; other
  4xx responses are treated as consumer/config errors and are not retried.
- **Audit:** every delivery is recorded in `outbound_webhook_deliveries` (metadata only —
  attempts, last status, secret-free error, delivered timestamp; never the payload body).
- **Fail-soft:** a webhook outage never fails or rolls back the approval that triggered it.
  Undelivered approvals are retried by the Gate #2 run-level sweep.
