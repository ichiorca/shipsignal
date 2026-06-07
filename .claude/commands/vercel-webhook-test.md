---
description: Exercise Vercel webhooks locally — x-vercel-signature (HMAC-SHA1 raw-body) verification, event-id idempotency/replay, and sandbox-vs-prod secret separation.
argument-hint: [route path or event type]
allowed-tools: Read, Grep, Glob, Bash, Edit, Write
---

You are exercising **Vercel webhook handling** locally for this Next.js (App Router) + TypeScript project. Vercel signs every webhook with an `x-vercel-signature` header containing an **HMAC-SHA1 hex digest of the raw request body**, keyed by your webhook secret. Your job is to prove the handler (1) verifies that signature against the raw body, (2) is idempotent on the event `id`, and (3) keeps sandbox and prod secrets separated. Do NOT call real Vercel APIs or hit production endpoints — everything runs against the local dev server with locally-generated signatures.

Argument: `$ARGUMENTS` may name the webhook route (e.g. `app/api/webhooks/vercel/route.ts`), an event type (e.g. `deployment.succeeded`), or be empty. If empty, discover the handler.

## 1. Locate the handler and its conventions
- Find the route: `rg -l "x-vercel-signature" app/ src/ pages/ 2>$null` and `rg -l "createHmac\(['\"]sha1" .`. Also check `app/api/**/route.ts` and `pages/api/**` for a Vercel webhook receiver. If `$ARGUMENTS` names a path/event, scope to it.
- Read the handler. Confirm it reads the **raw** body (`await request.text()` in App Router, or `getRawBody` + `export const config = { api: { bodyParser: false } }` in Pages Router) BEFORE `JSON.parse`. Flag immediately if it verifies against a re-serialized/parsed body — that breaks signature matching.
- Identify the secret env var(s) (commonly `WEBHOOK_SECRET` / `VERCEL_WEBHOOK_SECRET`) and how the handler records processed event `id`s for idempotency (DB table, Aurora row, in-memory set, etc.).

## 2. Verify the signature contract (the timeless rules)
Confirm the handler does ALL of these; report any it misses:
1. Computes `crypto.createHmac('sha1', secret).update(rawBody).digest('hex')` and compares to the `x-vercel-signature` header.
2. Uses a **constant-time** comparison (`crypto.timingSafeEqual`) with a length guard — not `===`.
3. Rejects with a 4xx (Vercel docs use **403**) when the header is missing or the signature mismatches.
4. Returns 2xx quickly only AFTER verification; never processes an unverified body.

## 3. Build a local signing helper
Write a throwaway script (e.g. `scripts/sign-vercel-webhook.mjs`, delete or .gitignore after) that signs a fixture body with a test secret:
```js
import crypto from 'node:crypto';
const secret = process.env.WEBHOOK_SECRET ?? 'test_secret';
const body = JSON.stringify({
  id: process.env.EVENT_ID ?? 'evt_local_1',
  type: process.env.EVENT_TYPE ?? 'deployment.succeeded',
  createdAt: 1717000000000, // fixed timestamp — keep deterministic
  region: 'iad1',
  payload: { /* shape from docs / the handler's expected type */ }
});
const sig = crypto.createHmac('sha1', secret).update(body).digest('hex');
process.stdout.write(JSON.stringify({ body, sig }));
```
Keep the body string byte-identical to what you POST — re-serializing changes the signature.

## 4. Run the matrix against the local dev server
Start the app (`pnpm dev` / `npm run dev` — use whatever `package.json` defines; pick the right package manager from the lockfile) and POST to the route with `curl` (or a small `node`/`fetch` script). Use the SAME secret the dev server has in `.env.local`.

Test cases — assert the status/behavior for each:
- **Valid signature** → 2xx, event processed once. Use `Content-Type: application/json`, header `x-vercel-signature: <sig>`, body `<body>` exactly.
- **Tampered body / wrong signature** → 403 (or handler's reject code), NOT processed.
- **Missing header** → 403.
- **Replay / idempotency**: POST the *same* valid request (same `id`) twice. Assert the side effect (DB row, downstream call, Aurora insert) happens exactly once and the second call is a no-op 2xx. Then POST with a new `id` and confirm it IS processed — proves dedup keys on `id`, not on payload.
- **Event-type routing**: if `$ARGUMENTS` named a type, send it and assert correct branch; send an unknown `type` and assert it's ignored gracefully (no crash, benign 2xx).

Example valid call (PowerShell-friendly):
```bash
OUT=$(WEBHOOK_SECRET=$SECRET node scripts/sign-vercel-webhook.mjs)
BODY=$(node -e "process.stdout.write(JSON.parse(process.argv[1]).body)" "$OUT")
SIG=$(node -e "process.stdout.write(JSON.parse(process.argv[1]).sig)" "$OUT")
curl -sS -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3000/api/webhooks/vercel \
  -H 'content-type: application/json' -H "x-vercel-signature: $SIG" --data "$BODY"
```

## 5. Sandbox vs prod secret separation
- Confirm the dev/sandbox secret comes from `.env.local` (or a `*_SANDBOX` var) and is DISTINCT from the production secret, which must come from the Vercel project env / a secret store — never a literal in source. `rg` the repo for hardcoded secrets or a single shared secret across environments and flag it.
- Prove rejection across environments: sign a body with the **sandbox** secret and POST it while the handler is configured with the **prod** secret (or vice-versa) → expect 403. This catches accidentally sharing one secret everywhere.
- Account webhooks use the secret shown once at creation; **integration** webhooks use the Integration/Client Secret; **log drains** use the drain secret. If this app receives more than one source, verify each maps to its own secret.

## 6. Lock it in with a test
If there's no automated coverage, add one. Prefer a route/unit test (Vitest/Jest) that imports the handler and asserts the valid/invalid/replay matrix using the signing helper above; if the flow is UI- or deployment-driven, add a Playwright test instead. Reuse the project's test runner — run the suite (`pnpm test` / `npm test`) and the existing lint/typecheck (`pnpm lint`, `tsc --noEmit`) and report results. Do not weaken the signature check to make a test pass.

## 7. Report
Summarize: handler location, whether raw-body + timing-safe verification is correct, the result of each matrix case (valid / tampered / missing / replay / cross-env), idempotency key used, sandbox-vs-prod separation status, and any fixes you made. Clean up throwaway scripts. Quote exact failures with status codes.
