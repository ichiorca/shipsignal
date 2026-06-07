---
description: Exercise ElevenLabs webhooks locally: signature verification, 30-min timestamp tolerance, replay/idempotency, and sandbox-vs-prod secret separation.
argument-hint: [handler path or event type, optional]
allowed-tools: Read, Grep, Glob, Bash, Edit, Write
---

You are exercising ElevenLabs webhook handling for this Next.js (App Router, TypeScript) + Python repo, **locally and safely**. Never call the live ElevenLabs API, never use a real production webhook secret, and never send real PII through the handler. `$ARGUMENTS` may name the handler path, route, or an event type to focus on (e.g. `post_call_transcription`); if empty, discover the handler yourself.

## Ground rules (timeless, from ElevenLabs webhook security model)
- Signature header is **`ElevenLabs-Signature`** (compare case-insensitively). Its value is a comma-separated list containing a timestamp part `t=<unix_seconds>` and a signature part `v0=<hex>`.
- The signed message is the string **`` `${t}.${rawBody}` ``** (timestamp, a literal dot, then the **raw, unparsed** request body). The expected signature is `v0=` + **HMAC-SHA256(webhook_secret, message)** as lowercase hex. Compare with a **constant-time** equality check.
- The webhook signing secret is workspace-issued and prefixed **`wsec_`**. It is distinct per webhook/environment — a sandbox secret must never validate a prod payload and vice-versa.
- **Timestamp tolerance is 30 minutes**: reject if `now - t` exceeds the window (replay/clock-skew defense).
- **Idempotency**: ElevenLabs retries `post_call_transcription` up to 5 times (immediate, 30s, 2m, 8m, 30m) on `5xx`/`429`/`408`; consumers *cannot* distinguish a retry from the first delivery. Dedupe on `event_timestamp` + an event identifier (e.g. `conversation_id`). `4xx` (other than 408/429) is treated as a config error and is **not** retried, and a webhook auto-disables after ~10 consecutive failures — so the handler must return 2xx fast and do heavy work out-of-band.
- Prefer the official SDK verifier (`elevenlabs.webhooks.constructEvent` in TS / `client.webhooks.construct_event` in Python) when present; it does signature + timestamp validation for you. The manual rules above are what it enforces and what your tests must independently assert.

## Steps

1. **Read the project's ElevenLabs skill** at `.claude/skills/elevenlabs-integration/SKILL.md` and follow its conventions for secret handling and verification. (Read it with the Read tool; if blocked, Grep it for `signature`, `wsec_`, `construct`.)

2. **Locate the handler.** If `$ARGUMENTS` gives a path, start there. Otherwise Grep the repo:
   - `Grep -i "elevenlabs-signature"`, `Grep "constructEvent|construct_event"`, `Grep "wsec_"`, `Grep -ri "webhooks/elevenlabs"`.
   - Typical locations: a Next.js App Router route handler `app/api/webhooks/elevenlabs/route.ts` (the `POST` export), or a Python handler in the media/narration path. Confirm which runtime owns the endpoint.

3. **Audit raw-body access (most common bug).** In a Next.js App Router route the body MUST be read with `await req.text()` (raw string) and the signature verified against *that exact string* — verifying against `JSON.stringify(await req.json())` re-serializes and breaks the HMAC. Confirm the handler captures raw bytes before parsing. Flag it if it doesn't.

4. **Audit secret separation (sandbox vs prod).** Confirm the secret is read from env (e.g. `ELEVENLABS_WEBHOOK_SECRET`), never hard-coded, and that sandbox and prod use *different* env values (e.g. `ELEVENLABS_WEBHOOK_SECRET` vs a `_SANDBOX`/`_PROD` split or per-Vercel-environment vars). Confirm `.env*` is gitignored and no `wsec_` literal is committed (`Grep -r "wsec_"` over tracked files). Report any leak as a hard failure.

5. **Build a local signing harness** (the only way to produce valid signatures without ElevenLabs). Write a throwaway helper next to the tests that, given a JSON body + a **local test secret** (e.g. `wsec_test_local`) + a timestamp, emits a valid `ElevenLabs-Signature` header. Reference implementation:
   - TS: `const msg = `${t}.${rawBody}`; const sig = 'v0=' + crypto.createHmac('sha256', secret).update(msg).digest('hex'); const header = `t=${t},${sig}`;`
   - Python: `import hmac, hashlib; mac = hmac.new(secret.encode(), f"{t}.{raw}".encode(), hashlib.sha256).hexdigest(); header = f"t={t},v0={mac}"`
   Set the handler's secret env to the same local test secret for the run.

6. **Start the endpoint locally and drive it.** Boot the dev server (`npm run dev` / `next dev`, or the Python app's runner) on a known port. Use a realistic `post_call_transcription` fixture body (synthetic data only). Send requests with PowerShell `Invoke-RestMethod`/`Invoke-WebRequest` (this is a win32/PowerShell shell) or `curl`, setting the `ElevenLabs-Signature` header from the harness and posting the **exact** raw body string you signed. Prefer wiring these as automated tests (Playwright API request context `npx playwright test`, or `pytest`) so they're repeatable.

7. **Run these cases and assert outcomes:**
   - **Valid signature** (fresh `t`, correct secret) → `2xx`, event processed once.
   - **Tampered body** (sign body A, POST body B) → rejected `4xx`, no processing.
   - **Missing / malformed header** (no `ElevenLabs-Signature`, or missing `t=`/`v0=`) → rejected.
   - **Stale timestamp** (`t` set to now − 31 min, otherwise valid) → rejected by the 30-min tolerance.
   - **Wrong-environment secret** (sign with prod-style secret, handler holds sandbox secret) → rejected — proves sandbox/prod isolation.
   - **Replay / idempotency** (POST the *same* valid payload twice, same `conversation_id`+`event_timestamp`) → processed exactly once; second delivery is a safe no-op (assert no duplicate row/job/audio). This simulates an ElevenLabs retry.
   - **Fast-2xx contract** (optional) → handler acks quickly and offloads heavy work, so retries/auto-disable aren't triggered.

8. **Verify dedupe persistence.** If dedup is in Aurora/Postgres, confirm the unique key is on `(conversation_id, event_timestamp)` (or equivalent) and that the second delivery hits the conflict path, not a crash. Inspect the relevant migration/repository code.

9. **Run the project gates** before reporting: type/lint/test for the touched runtime (e.g. `npm run lint && npm test`, and/or `pytest && ruff check . && mypy .`). Use the project's smoke/test skills if present.

10. **Report** a concise table: each case → expected vs actual → pass/fail, plus any findings on raw-body handling, secret separation, timestamp window, and idempotency. Delete throwaway harness files (keep committed automated tests if you added them). Do not commit unless asked.

If the handler is missing or incomplete, say so and propose the minimal verifier (raw body → parse `t`/`v0` → 30-min check → constant-time HMAC compare → dedupe on `conversation_id`+`event_timestamp`) rather than inventing endpoints.
