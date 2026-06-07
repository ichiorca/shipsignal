---
description: Audit a change for privacy compliance: data minimization, redaction-before-persistence/LLM, Bedrock Guardrails PII filters, PII-off-client, GDPR data-subject rights, and CCPA/GPC opt-out handling.
argument-hint: [file, path, or PR/diff range — defaults to working diff]
allowed-tools: Read, Grep, Glob, Bash
---

You are running a **privacy compliance audit** of a code change in this Next.js (App Router) + React + TypeScript/Python release-to-content engine, which handles release evidence that may contain PII (commit authors, emails, issue reporters, UI strings, screenshots) and persists it to Aurora/pgvector + S3. Be concrete and evidence-based: cite `file:line` for every finding, and do not flag what you cannot point to.

## 0. Scope the change
- Target = `$ARGUMENTS` if provided (a file, directory, or PR/diff range); otherwise audit the working diff via `git diff --stat` then `git diff`.
- List the changed files and classify each: UI/client (`app/`, `components/`, `*.tsx`), API/server (`app/api/`, route handlers, server actions), LangGraph nodes (`*graph*`, extractors/redactors), data layer (Aurora/pgvector, migrations in `db/`), media (Playwright/ffmpeg/S3), config/env.
- Load the project's own guidance first: read `skills/sources/domain-privacy-patterns.md` and `skills/sources/privacy-eval.md`. Treat their rules as the local source of truth and reconcile your findings with them.

## 1. Data minimization & purpose limitation (GDPR Art. 5(1)(b)(c))
- For each new field, column, log line, LangGraph state key, or evidence record the change adds: confirm the data is **necessary** for an approved purpose. Flag speculative "collect just in case" fields, over-broad `SELECT *`, full-object logging, and raw diffs/PR bodies stored unredacted.
- New Aurora tables/columns (check `db/` migrations): verify a retention/erasure story exists and PII columns are documented. Flag indefinitely-retained personal data with no TTL or deletion path.
- Verify pgvector embeddings are not built from un-redacted PII (embeddings are hard to erase later).

## 2. Redaction before persistence & before LLM (pipeline boundary)
- This codebase's rule: **evidence must be redacted/normalized before it enters LangGraph state, Aurora, pgvector, or S3, and before it is sent to Bedrock.** Trace each new data path and confirm a redaction step precedes every sink. Flag any path where raw `git diff`, PR/issue text, author emails, or screenshots reach a sink or a model call un-redacted.
- Bedrock calls: confirm a **Guardrail with a sensitive-information (PII) filter** is attached (action `ANONYMIZE` to mask as `{EMAIL}`/`{NAME}` or `BLOCK`), and that custom regex covers project/region-specific identifiers. Flag Converse calls with no `guardrailIdentifier`/`guardrailVersion`. Verify guardrails run on **both** input and model output.
- Generated marketing/sales artifacts: confirm claims are checked so no PII leaks into published content.

## 3. PII off the client (Next.js / React)
- Confirm no PII or secrets cross into client components or the browser bundle: check for PII in props passed from Server to Client Components, in `NEXT_PUBLIC_*` env vars, in client-side `fetch` payloads, in React state/localStorage, and in `<script>`/JSON hydration. Server-only secrets must never be imported into `"use client"` files.
- Confirm API routes/server actions enforce authz before returning any personal data, and error responses don't echo raw PII.

## 4. Data subject rights (GDPR Arts. 15–22) & deletion paths
- For new personal-data stores, verify a query/path exists to **locate and erase** a subject's data across Aurora, pgvector, and S3 artifacts (erasure must cascade to embeddings, screenshots, audio, and cached media). Flag stores with no deletion path.
- Verify audit-log coverage so a DSAR (access/erasure) can be answered. Note where deletion is technically hard (e.g. data baked into derived artifacts) and call it out explicitly.

## 5. UI consent & opt-out signals (CCPA/CPRA + GPC)
- If the change touches the user-facing UI, analytics, cookies, or any third-party scripts: confirm non-essential trackers are gated behind consent and that the app honors the **Global Privacy Control** signal (`navigator.globalPrivacyControl` / `Sec-GPC: 1`) as a Do-Not-Sell/Share opt-out **without** requiring extra clicks. Per CCPA regs effective 2026, the UI must **visibly reflect** that an opt-out signal was recognized — flag if it doesn't.
- Cookie/consent banners: verify they are keyboard-operable and screen-reader-accessible (cross-check `skills/sources/ux-a11y.md`); a non-accessible consent gate is a compliance gap.

## 6. Secrets & transit/at-rest security
- No hardcoded keys (Bedrock/AWS, ElevenLabs `xi-api-key`, DB creds) in source, tests, or fixtures — `grep` the diff. Confirm secrets come from env/broker.
- Confirm TLS for data in transit and encryption at rest for new S3/Aurora storage; flag any plaintext personal-data sink.

## 7. Run the project's gates
- Run the privacy eval suite if present: `harness eval` (or the privacy-tagged subset). Report CRITICAL/HIGH results (PII/PHI exposure, redaction integrity, claim provenance) — these are release-blocking.
- Run available lint/type/test gates for touched code (TS and Python). Report failures verbatim; do not fix unless asked.

## Output
Produce a markdown report:
1. **Verdict** — PASS / PASS-WITH-RISKS / FAIL.
2. **Blocking issues** — each with `file:line`, the rule violated (cite GDPR article / CCPA-GPC / project skill), and a concrete fix.
3. **Recommendations** — non-blocking minimization/hardening improvements.
4. **Eval/gate output** — pass/fail summary.
5. **Not covered** — paths or obligations you could not verify, so a human follows up.
State assumptions; never report a gap as resolved that you didn't verify.
