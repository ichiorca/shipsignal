---
description: Exercise Bedrock webhook handling locally — SNS-subscription signature verification (SigningCertURL/SignatureVersion), EventBridge API-destination secret auth, MessageId/event-id idempotency/replay, and sandbox-vs-prod secret separation.
argument-hint: [fixture | sns|eventbridge | sandbox|prod | <detail-type>]
allowed-tools: Read, Grep, Glob, Bash, Edit, Write, Skill
---

Exercise this project's Amazon Bedrock webhook handling end-to-end **locally**: signature/authenticity verification, idempotency/replay, and sandbox-vs-prod secret separation. This mirrors `/github-webhook-test` but for Bedrock's delivery model.

**Critical grounding — do not hallucinate an HMAC webhook.** Amazon Bedrock does **not** POST a signed webhook directly. Async/batch work emits **EventBridge** events (`source: "aws.bedrock"`; detail-types include `"Batch Inference Job State Change"`, `"Model Customization Job State Change"`, `"Bedrock Data Automation Job Succeeded"` / `... Failed With Client Error"` / `... Failed With Service Error"`; best-effort delivery). Those events reach an external HTTPS endpoint by one of two paths, and our handler must support whichever this repo uses:
- **SNS HTTPS subscription** (`Bedrock → EventBridge → SNS topic → HTTPS endpoint`): the POST body **is** cryptographically signed. Verify it via `SigningCertURL` + `Signature` + `SignatureVersion` (NOT an HMAC shared secret).
- **EventBridge API destination** (`Bedrock → EventBridge → API destination`): EventBridge does **not** sign the body. The receiver authenticates a connection credential (`Basic`, `API Key`, or `OAuth Client Credentials`) carried in a header — typically a shared-secret/API-key header.

Argument: `$ARGUMENTS` optionally scopes the run — a fixture path, one of `sns` / `eventbridge`, one of `sandbox` / `prod`, or a Bedrock detail-type (e.g. `Batch Inference Job State Change`). If empty, run the full matrix.

---

### 1. Orient (read-only first)
- Invoke the `aws-bedrock-integration` skill for this repo's Bedrock credential/secret, idempotency, and sandbox-vs-prod conventions; also check `s3-integration` (batch output lands in S3) and the `github-webhook-test` command as the structural template to match.
- Locate the inbound handler: search `app/api/**/route.ts`, `pages/api/**`, or any Python handler for `aws-sns-message-type`, `SigningCertURL`, `aws.bedrock`, `detail-type`, `MessageId`, `SubscribeURL`. Note the exact route path(s).
- Locate the verification helper (signature/secret check) and any existing fixtures (`**/__fixtures__/**`, `**/fixtures/**`, `*.event.json`).
- Read `.env.example` / config to learn the real secret env-var names. Expect distinct sandbox vs prod values (e.g. a per-environment SNS topic-ARN allowlist and, for the API-destination path, a webhook shared-secret/API-key). Do **not** print secret values.
- Detect the toolchain from `package.json` (npm/pnpm/yarn — use whichever lockfile exists) and `pyproject.toml`. Identify the real `test`, `lint`, and `typecheck` scripts; do not assume. Note the agent-harness gate referenced in AGENTS.md (e.g. `harness eval`) for the final safety pass.

### 2. Build/refresh local fixtures
Create fixtures under the repo's existing fixtures dir (create one only if none exists). Cover, scoped by `$ARGUMENTS`:
- **SNS `SubscriptionConfirmation`** — JSON with `Type`, `MessageId`, `Token`, `TopicArn`, `Message`, `SubscribeURL`, `Timestamp`, `SignatureVersion`, `Signature`, `SigningCertURL`; header `x-amz-sns-message-type: SubscriptionConfirmation`.
- **SNS `Notification`** whose `Message` is a stringified Bedrock EventBridge event (`source: "aws.bedrock"`, a real `detail-type`, and `detail.status` like `Completed`/`Failed`); headers `x-amz-sns-message-type: Notification`, `x-amz-sns-message-id`, `x-amz-sns-topic-arn`.
- **Raw EventBridge event** (API-destination path): envelope `id`, `time`, `region`, `account`, `source: "aws.bedrock"`, `detail-type`, `resources`, `detail`.
- Generate **real** SNS signatures locally so verification is genuinely exercised: mint a throwaway self-signed cert, build the string-to-sign in the **exact field order** below, and sign. Point the handler/test at the local cert (override the cert-fetch in test config) — never disable verification.
  - `Notification` string-to-sign fields, in this order, `\n`-joined as `Key\nValue` with NO trailing newline: `Message`, `MessageId`, `Subject` (only if present), `Timestamp`, `TopicArn`, `Type`.
  - `SubscriptionConfirmation`/`UnsubscribeConfirmation`: `Message`, `MessageId`, `SubscribeURL`, `Timestamp`, `Token`, `TopicArn`, `Type`.

### 3. Signature / authenticity tests
POST fixtures at the local handler (run the dev server, or call the route handler / verifier unit directly):
- **SNS valid** signature → accepted; handler responds **HTTP 200** (and within the ~15s SNS timeout).
- **Tampered body** (mutate `Message`/`detail` after signing) → rejected.
- **`SignatureVersion`** `1` (SHA1) and `2` (SHA256) both verify against the right algorithm; assert v2/SHA256 is the supported/recommended path.
- **Malicious `SigningCertURL`** (host not `sns.<region>.amazonaws.com`, or non-HTTPS) → rejected **before** any fetch. This is the #1 SNS bypass — assert the host/scheme allowlist exists.
- **`SubscriptionConfirmation`** → handler confirms via `SubscribeURL`/`Token`; in tests, assert the confirm call is attempted against an allowlisted SNS host (stub the GET — never auto-confirm arbitrary URLs).
- **EventBridge/API-destination path**: request with the correct shared-secret/API-key header → accepted; missing or wrong credential → `401`/`403`. Confirm the check is constant-time and that EventBridge's lack of body signing is compensated by the secret header.

### 4. Idempotency / replay
- **SNS**: deliver the same `MessageId` (= `x-amz-sns-message-id`) twice → side effect (DB row / S3 write / downstream call) happens **once**. SNS retries up to 3× ~20s apart, so duplicates are expected — assert dedup keys off `MessageId`.
- **EventBridge**: replay the same event `id` → processed once (EventBridge is at-least-once, retrying many times over up to 24h). Assert dedup keys off the event `id`, not on payload contents.
- Verify the dedup store survives a process restart if the handler claims durable idempotency (check the Aurora/idempotency table or equivalent).

### 5. Sandbox vs prod separation
- Confirm sandbox and prod use **distinct** secrets/identifiers: separate SNS topic-ARN allowlists and separate API-destination shared secrets, sourced from per-environment env vars (never a shared default).
- Send a **prod** fixture (prod `TopicArn` / prod-signed secret) to the **sandbox** handler → rejected. And vice-versa. No secret value crosses environments.
- Confirm the sandbox path cannot reach prod Bedrock/S3 resources (region/account/bucket differ) and that egress stays within the harness allowlist.

### 6. Run the gate & report
- Run the project's real commands (discovered in step 1), e.g. typecheck, lint, the unit/integration suite for the webhook route, and any Playwright e2e that drives the dashboard's webhook/delivery view. Then run the agent-harness safety gate (e.g. `harness eval`).
- If any verification, idempotency, or separation assertion is missing, add a failing test first, then the minimal fix — do not weaken verification to make a test pass.
- Summarize: paths/handlers exercised, which delivery path(s) the repo supports, pass/fail per category (signature, cert-host allowlist, idempotency, sandbox/prod), and any gaps with file:line references. Never print secret or token values.
