---
description: Exercise GitHub webhook handling locally: HMAC-SHA256 signature verification, delivery-GUID idempotency/replay, and sandbox-vs-prod secret separation.
argument-hint: [event type, delivery GUID, or 'all']
allowed-tools: Read, Grep, Glob, Bash, Edit, Write
---

You are exercising this project's **GitHub webhook handling** end-to-end on a local/sandbox setup: HMAC signature verification, replay/idempotency via the delivery GUID, and sandbox-vs-prod secret separation. Do NOT touch production secrets or send anything to a production endpoint.

`$ARGUMENTS` selects the focus: an event name (e.g. `push`, `release`, `pull_request`), a specific delivery GUID to replay, or `all` (default if empty) to run the full matrix.

First, read the project's `github-integration` skill (`.claude/skills/github-integration/SKILL.md`) and follow its conventions. Use `security-review` for the verification logic.

## 1. Locate the handler and its tests
- `grep -ri "x-hub-signature-256" --include=*.ts --include=*.py .` and `glob app/api/**/route.ts` to find the inbound route handler (Next.js App Router — likely `app/api/webhooks/github/route.ts`) and any Python worker that re-validates payloads.
- Find the secret it reads from env (e.g. `GITHUB_WEBHOOK_SECRET`) and the idempotency store (per the spec, an Aurora ledger keyed by delivery GUID).
- Find existing tests (`*.test.ts`, `tests/**/*.py`). If none cover the cases below, scaffold them next to the handler using the project's test runner.

## 2. Audit the verification against current GitHub rules (do not weaken these)
Confirm the handler enforces ALL of the following; flag and fix any miss:
- Reads the **`X-Hub-Signature-256`** header (value always starts with `sha256=`). The legacy SHA-1 `X-Hub-Signature` header MUST NOT be accepted as proof.
- Computes an **HMAC-SHA256 hex digest** over the **raw request body bytes** (NOT a re-serialized/parsed JSON object) using the webhook secret as the key. In the Next.js route this means reading the raw body (`await req.text()`) before parsing.
- Compares using a **constant-time** comparison — `crypto.timingSafeEqual` (TS) / `hmac.compare_digest` (Python), never `===`/`==`.
- Rejects with `401` when the header is missing, malformed, or fails verification, and returns a 2xx **only** after verification passes.
- Reads the secret from an env var, never hardcoded.

## 3. Run the signature test matrix
Use GitHub's documented canonical test vector to prove the HMAC is correct:
- secret = `It's a Secret to Everybody`, body = `Hello, World!` → expected header `sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17`.
Write/extend tests (and run them) covering:
1. **Valid** signature → 2xx, payload processed.
2. **Tampered body** (signature unchanged) → 401, not processed.
3. **Missing** `X-Hub-Signature-256` → 401.
4. **Wrong secret** → 401.
5. **SHA-1-only** request (`X-Hub-Signature` present, no `-256`) → rejected.
6. Body read as **raw bytes** — add a payload with non-ASCII/whitespace that would change under re-serialization to prove parsed-JSON isn't being signed.

## 4. Idempotency / replay
GitHub sends a globally unique **`X-GitHub-Delivery`** GUID per event, and **a redelivery reuses the same GUID**. Verify:
- Two POSTs with the **same** valid `X-GitHub-Delivery` are processed **once** (second is a no-op / returns 2xx without duplicating side effects in the Aurora ledger or S3).
- Distinct GUIDs are processed independently.
- The handler branches on **`X-GitHub-Event`** + the top-level `action` key before doing work, and ignores event types it doesn't handle with a 2xx.
- Confirm it still returns a **2xx within ~10s** (offload heavy work async, per GitHub best practice) so GitHub doesn't retry.
If `$ARGUMENTS` is a delivery GUID, replay that exact GUID twice and assert single processing.

## 5. Sandbox vs prod separation
- Confirm sandbox and prod use **distinct secrets and distinct env vars** (e.g. `GITHUB_WEBHOOK_SECRET` vs a sandbox value in `.env.local`), and that the handler selects by environment, not by hardcoded branch.
- Confirm no prod secret is present in committed files or test fixtures (`grep` for likely secret patterns).
- Ensure tests run against the **sandbox** secret only.

## 6. Drive a real local delivery (optional, if a repo + tooling are available)
Start the dev server (`npm run dev`, handler at `http://localhost:3000/api/webhooks/github`), then forward real deliveries with the GitHub CLI extension:
- `gh extension install cli/gh-webhook`
- `gh webhook forward --repo=<org/repo> --events=<event or '*'> --url=http://localhost:3000/api/webhooks/github`
(Repository/org webhooks only; for-testing-only — not for production.) Alternatively use `smee.io` + `smee-client` if `gh` is unavailable. Trigger the event and confirm a 2xx in the dev log and the expected ledger write. If this project drives UI flows, you may use Playwright to trigger and assert the resulting dashboard state.

## 7. Report
Run the relevant test command (`npm test` / `npx playwright test` for TS, `pytest` for Python) plus lint, and report: which cases passed/failed, any fixes you made to the verification or idempotency logic, and any sandbox/prod separation gaps. Do NOT mark passing if any signature, replay, or secret-separation case fails.
