---
description: Exercise the S3 event-notification webhook locally — SNS signature verification (SigningCertURL/SignatureVersion v2), MessageId + sequencer idempotency/replay, the EventBridge API-destination secret path, and sandbox-vs-prod separation.
argument-hint: [handler path | sns | eventbridge | event-type — default: all]
allowed-tools: Read, Grep, Glob, Edit, Write, Bash, Skill
---

You are exercising this project's **inbound S3 event-notification webhook** end-to-end on a local dev server: signature verification, idempotency/replay, and sandbox-vs-prod separation. S3 has no native "webhook" — event notifications reach an external HTTPS endpoint over one of two paths, and you must test whichever this repo implements:

1. **S3 → SNS → HTTPS subscriber** (the SNS envelope is POSTed to your route; `Message` is the stringified S3 `Records` JSON). Auth = **SNS message-signature verification**.
2. **S3 → EventBridge → API destination (HTTPS)**. Auth = an EventBridge **Connection** shared secret/header (Basic / API-key / OAuth).

`$ARGUMENTS` selects scope: a handler path, or one of `sns` / `eventbridge` / an event type like `s3:ObjectCreated:Put`. If empty, discover and test every path the repo implements.

Work the steps in order. Do not skip the negative/security cases — they are the point.

## 0. Orient
- Invoke the **s3-integration** skill (and **security-review** for the verification cases). If `$ARGUMENTS` names a path, scope to it.
- Locate the handler(s): search the Next.js App Router for route handlers, e.g. `Grep` for `s3:ObjectCreated`, `sequencer`, `TestEvent`, `SubscriptionConfirmation`, `SignatureVersion`, `SigningCertURL`, `x-amz-sns-message-type`, and any EventBridge API-destination header check. Note the file paths (typically `app/api/**/route.ts`) and how they parse the SNS envelope vs. the raw EventBridge payload.
- Read the project's `package.json` scripts and `.env.example`. Use the repo's **actual** commands; the defaults below are fallbacks only. Identify the sandbox-vs-prod config split (e.g. `*_SANDBOX` vs `*_PROD` topic ARNs / shared secrets, brokered via the harness secret broker — never hardcode real secrets).

## 1. Start the endpoint
- Launch the dev server with the project's script (fallback: `npm run dev`, Next.js on `http://localhost:3000`). Confirm the route responds before sending crafted payloads.

## 2. SNS path — signature verification (the security core)
S3 wraps the event in an SNS envelope. The POST body has `Type`, `MessageId`, `TopicArn`, `Message` (stringified S3 `Records`), `Timestamp`, `SignatureVersion`, `Signature`, `SigningCertURL`, plus header `x-amz-sns-message-type`. Verification rules (must all hold):
- **SignatureVersion 2 (SHA256) is required/preferred**; treat `SignatureVersion: 1` (SHA1) as legacy — assert the handler rejects or refuses to silently accept it if your policy is v2-only.
- The string-to-sign is built from sorted message fields as `key\nvalue\n` pairs: for `Notification` → `Message, MessageId, Subject?, Timestamp, TopicArn, Type`; for `SubscriptionConfirmation`/`UnsubscribeConfirmation` → `Message, MessageId, SubscribeURL, Timestamp, Token, TopicArn, Type`.
- `SigningCertURL` **must be validated to be a genuine Amazon SNS host (HTTPS, `*.amazonaws.com`) BEFORE the cert is fetched** — this is the SSRF/forgery guard.
- `TopicArn` must match an expected topic; reject unexpected topics.

To sign locally: generate a throwaway RSA keypair + self-signed cert, point the handler's cert resolver at it **only in sandbox/test mode**, build the canonical string, and sign with the matching algorithm. Then run these cases:
- **Valid v2 Notification** (well-formed S3 `Records` in `Message`) → `200`, business logic runs once.
- **Tampered body / mismatched signature** → rejected, **no** processing.
- **`SigningCertURL` on a non-`amazonaws.com` host** (e.g. `https://evil.example.com/cert.pem`) → rejected *before* any cert fetch.
- **Unexpected `TopicArn`** → rejected.
- **`SubscriptionConfirmation`** → signature verified first; auto-confirm (visit `SubscribeURL`) **only in non-prod**.
- **`s3:TestEvent`** (flat `{Service, Event:"s3:TestEvent", Bucket, ...}`, NOT the `Records` shape) → acknowledged, no business processing.

## 3. Idempotency & replay
- POST the **same `MessageId` twice** → side effects happen exactly once (dedup ledger / Aurora unique key).
- For the same object `key`, deliver events out of order using the S3 **`sequencer`** (hex string; left-pad shorter to compare lexicographically). A lower `sequencer` arriving after a higher one must **not** regress state. Remember delivery is *at-least-once* and unordered.

## 4. EventBridge API-destination path (if implemented)
- Deliver the raw S3 event with the Connection's auth header (API-key custom header, or `Authorization` for Basic/OAuth). **Valid secret → accepted; missing/wrong → `401`/`403`.**
- Dedup on the event id / `sequencer` as in step 3. Note the receiver must respond within EventBridge's **5s** timeout; retries fire on `401/407/409/429/5xx`.

## 5. Sandbox vs prod separation
- A message signed/secreted for **sandbox** must be rejected by the **prod** config and vice versa (distinct topic ARNs + secrets).
- Confirm **auto-confirm of subscriptions is disabled in prod**.
- Confirm no real prod secret is read in test mode (harness secret broker scoping).

## 6. Gate & report
- Run the project's checks (fallbacks): `npx playwright test` for any e2e webhook flow, plus `npm run lint` / `npm run typecheck` (`tsc --noEmit`); for Python handlers `pytest`, `ruff check`, `mypy`. Add a regression test for any uncovered case above.
- Report a table: each case → expected vs. actual → pass/fail, with the handler file:line that enforces it. Call out any negative case that did **not** fail closed as a security finding.

Use only sandbox/test credentials and locally generated certs. Never POST to a real prod endpoint or commit secrets.
