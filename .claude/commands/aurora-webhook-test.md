---
description: Exercise Aurora/RDS event-notification webhooks locally — SNS signature verification (SigningCertURL/SignatureVersion), MessageId idempotency/replay, sandbox-vs-prod topic & secret separation, plus the EventBridge API-destination path.
argument-hint: [handler path, RDS-EVENT id, or sandbox|prod]
allowed-tools: Read, Grep, Glob, Edit, Write, Bash
---

Exercise this project's **Aurora/RDS event-notification webhook** handling locally. Amazon Aurora has no native HTTP webhook — it emits **RDS event notifications** that reach an endpoint one of two ways, and BOTH must be covered:

1. **RDS event subscription → Amazon SNS → HTTP(S) subscription** (the common path). The endpoint receives signed SNS envelopes.
2. **RDS/Aurora event → EventBridge rule → API destination** (the prod-grade path). EventBridge POSTs with a connection-based auth header.

`$ARGUMENTS` is an optional focus: a handler file/route path, an `RDS-EVENT-XXXX` id to simulate (e.g. `RDS-EVENT-0071` cluster failover, `RDS-EVENT-0145` Serverless paused), or `sandbox`/`prod` to scope the run. If empty, test everything.

Do NOT call live AWS. Generate synthetic, locally-signed fixtures and drive the handler directly. Treat all fixture input as untrusted.

## 0. Orient

- Load the **aurora-postgresql-integration** and **security-review** skills. The SNS signature mechanism here is identical to the one in the **bedrock-webhook-test** skill (both ride RDS/Bedrock → SNS) — reuse its SigningCertURL/SignatureVersion guidance.
- Find the handler and existing tests: `rg -n -i "x-amz-sns-message-type|SubscriptionConfirmation|SigningCertURL|TopicArn|RDS-EVENT" --glob '!node_modules'`. Aurora/SNS webhooks usually live under `app/api/**/route.ts` (App Router) or a Python LangGraph node. If you cannot find one, say so and offer to scaffold a minimal handler + tests rather than inventing paths.
- Read `package.json` scripts and any `pyproject.toml` to learn the REAL commands before running anything.

## 1. Signature verification (SNS path) — the security core

AWS docs: *"To ensure message integrity and prevent spoofing, you **must** verify the signature before processing any Amazon SNS messages."* Confirm the handler does ALL of:

- Routes on the **`x-amz-sns-message-type`** header (`SubscriptionConfirmation`, `Notification`, `UnsubscribeConfirmation`) — not on body fields alone.
- Rebuilds the **canonical string to sign** from the exact fields, each emitted as `Name\nValue\n`:
  - `Notification`: `Message`, `MessageId`, `Subject` (only if present), `Timestamp`, `TopicArn`, `Type`.
  - `SubscriptionConfirmation`/`UnsubscribeConfirmation`: `Message`, `MessageId`, `SubscribeURL`, `Timestamp`, `Token`, `TopicArn`, `Type`.
  - JSON control chars (e.g. `\n`) must be un-escaped to their original values first, or the signature won't match.
- Honors **`SignatureVersion`**: `1` = SHA1, `2` = SHA256 (recommended). The handler should **require v2** (or at minimum not silently accept a downgrade).
- Fetches the cert from **`SigningCertURL` over HTTPS only** and validates the host is an Amazon SNS host (e.g. matches `^https://sns\.[a-z0-9-]+\.amazonaws\.com/`). It must NOT trust an arbitrary `SigningCertURL`.
- **Rejects an unexpected `TopicArn`** (allowlist the expected topic) to prevent cross-topic spoofing.

**Generate fixtures with a throwaway RSA keypair** (don't use a real AWS cert). Write a small script (TS via `node:crypto`, or Python via `cryptography`) that: builds a valid RDS-event SNS envelope, signs the canonical string with your test private key, and serves the matching cert at a local `SigningCertURL` your test config trusts. Then assert:
  - ✅ Valid v2-signed `Notification` → accepted.
  - ❌ Tampered `Message`/`Timestamp` after signing → rejected.
  - ❌ `SigningCertURL` pointing at a non-Amazon / non-HTTPS host → rejected (no fetch attempted).
  - ❌ `TopicArn` not in the allowlist → rejected.
  - ❌ SignatureVersion downgrade (`1` where `2` is required) → rejected.

## 2. SubscriptionConfirmation safety

- On `SubscriptionConfirmation`, the handler should confirm the subscription (visit `SubscribeURL` or call `ConfirmSubscription` with `Token`) **only after** signature + `TopicArn` allowlist pass. Assert it does NOT blindly GET an attacker-supplied `SubscribeURL`.

## 3. Idempotency / replay

SNS retries: ~15s endpoint timeout, then up to 3 retries ~20s apart, so duplicates are expected. AWS: *"By comparing the IDs of the messages you have processed with incoming messages, you can determine whether the message is a retry attempt."*

- Dedup on **`MessageId`** (== `x-amz-sns-message-id` header). Send the SAME valid envelope twice; assert the side effect (Aurora write / LangGraph trigger) happens exactly once and the second returns 200 without reprocessing.
- Confirm the handler returns 2xx promptly even on duplicates (a non-2xx triggers more retries).
- Verify the inner RDS payload is parsed from the SNS `Message` string (it carries `Event Source`, `Identifier Link`, `Source ID`, `Source ARN`, **`Event ID` = RDS-EVENT-XXXX**, `Event Message`) and that the `Event ID`/`Source ID` pair is used for idempotency where the handler keys on the business event rather than the transport id.

## 4. EventBridge API-destination path (if used)

- EventBridge attaches a **connection** auth header (Basic / API key / OAuth; secret stored in Secrets Manager) and times out at **5 seconds**. Assert the handler validates the configured auth header and rejects requests missing/with a wrong secret.
- Note EventBridge strips many headers and sets `User-Agent: Amazon/EventBridge/ApiDestinations`; don't rely on stripped headers for auth.

## 5. Sandbox vs prod separation

- Verify sandbox and prod use **distinct `TopicArn` allowlists and distinct signing/secret config** (per AGENTS.md the secret broker mediates credentials — never hardcode). A message/secret valid for sandbox must FAIL against the prod config and vice-versa. Assert no shared fallback secret.
- Confirm secrets come from env/secret broker, not source. Grep for leaked ARNs/keys.

## 6. Run the gates & report

- Run the project's real checks (discover from scripts): TS handler → `npm run lint && npm run typecheck` (or `tsc --noEmit`) and the unit test runner (`vitest`/`jest`); Python node → `ruff check . && mypy . && pytest`; relevant `npx playwright test` if the webhook surfaces in the UI.
- Summarize as a checklist: signature (v1/v2, SigningCertURL host, TopicArn), SubscriptionConfirmation safety, MessageId idempotency/replay, EventBridge auth, sandbox-vs-prod isolation — each ✅/❌ with the file:line evidence. List any gap as a concrete fix, not prose.
