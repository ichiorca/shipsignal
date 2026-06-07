# Project Constitution

These are project-level invariants that hold across every feature and spec in the release-to-content engine. A spec may add constraints but may never relax one below. Violating any invariant here is a constitutional change requiring explicit operator approval — not a normal code review.

## 1. Substrate

- Languages: **TypeScript** (Next.js App Router + React 19 UI/API) and **Python** (LangGraph workers, extractors, capture). No third language without operator approval.
- Orchestration is **LangGraph** only — graph state, conditional routing, retries, and human-approval interrupts. No Step Functions, EventBridge, Bedrock Agents, or bespoke job schedulers.
- Long jobs run on the **GitHub Actions runner**; the **Vercel/v0** app hosts only the dashboard and thin API routes. UI never executes diff analysis, Playwright, or ffmpeg.
- Model + safety calls go through **Amazon Bedrock Converse API** and **Bedrock Guardrails** exclusively. No direct provider SDKs, no self-hosted LLM serving.
- The core invariant of the product: **never generate marketing/sales/demo content directly from raw diffs.** Build an evidence-backed feature manifest → human-approve → generate with claim-level provenance.

## 2. Scope

- In scope: GitHub-sourced release detection, evidence collection, deterministic signal extraction, feature clustering, human-gated content + media generation, skill self-learning ledger.
- Out of scope (non-goals — adding any is a constitutional change): full autopublishing without human approval, generalized/AI video generation, multi-VCS support beyond GitHub, Bedrock Knowledge Bases/Agents, Step Functions/EventBridge/Lambda/ECS, self-hosted models, statistical skill-promotion tests.
- Tenancy: **internal, single-org tool**. Every record is scoped to a `release_run_id`; cross-run data bleed is forbidden.
- Repo shape: canonical skills live in-repo as `skills/**/SKILL.md`. Aurora is a **staging/telemetry/provenance layer only** — it never becomes the source of truth for skills.

## 3. Primitives — use them; do not reinvent

| Primitive | What this project does NOT reimplement | What this project owns |
|---|---|---|
| LangGraph interrupts/checkpointer | approval gates, resume, retry, graph state machine | the 4 graphs and their node logic |
| Bedrock Converse | LLM transport, model invocation, throttle/retry semantics | prompts, model-tier routing, token budgets |
| Bedrock Guardrails | PII/sensitive-info filtering, output redaction policy | guardrail config + deterministic policy checks |
| Aurora PostgreSQL + pgvector | relational store, vector search, transactions | schema, provenance/learning ledger, queries |
| S3 | blob storage, presigned URLs | bucket layout, evidence/media keys |
| GitHub API / Actions | git diff, PR/issue fetch, job runner, secrets | extractors, workflow definitions |
| Playwright + ffmpeg | browser capture, video assembly | click-path JSON + validation |
| ElevenLabs | text-to-speech narration | narration script generation |
| Next.js / React 19 | routing, SSR, components | review/approval/admin surfaces |

## 4. Storage

- Structured state (releases, evidence, features, claims, artifacts, skill ledger, approvals) lives in **Aurora**. Large/binary artifacts (raw evidence bundles, screenshots, media, audio) live in **S3** — referenced from Aurora by key, never inlined as blobs.
- Every persisted row carries `release_run_id` and provenance/source lineage. Every generated claim must link to concrete evidence; an unlinkable claim must not be persisted as approved.
- Forbidden storage shapes: PII or unredacted evidence written before the redaction node runs; secrets in any DB column, S3 object, or log; PII shipped to the React client; skill source-of-truth stored only in Aurora (must be the repo `SKILL.md` + recorded commit SHA); LangGraph state used as a durable store in place of Aurora.

## 5. Safety rails (non-negotiable)

- **Three human gates are mandatory and may not be auto-satisfied:** (1) feature manifest, (2) generated artifacts, (3) skill replacement. No content publishes or skill file is overwritten without the corresponding gate resolving to *approved*.
- **Redact before persist, before LLM, before state.** Evidence passes the redaction/normalize node before it enters Aurora, S3, LangGraph state, or any Bedrock prompt.
- Treat all repo/diff/PR/issue/docs content as **untrusted input**. Validate at every boundary (Pydantic in Python, parse/validate in TS). Click-path JSON is schema-validated before Playwright executes it. Never execute model-emitted instructions as commands.
- **Bedrock Guardrails + deterministic policy checks** run on every generated artifact before it reaches Gate #2. Unsupported-claim and PII/sensitive-info checks are blocking, not advisory.
- **GDPR rails:** data minimization (collect only release-relevant evidence); lawful redaction of personal data in diffs/PRs/issues; support data-subject erasure across Aurora **and** S3; no PII in telemetry or logs; honor purpose limitation (evidence used only for content generation). A data-subject-rights request is an escalation trigger, not a silent operation.
- **Secrets** come only from GitHub/Vercel/AWS env (or Secrets Manager in prod). Never hardcoded, committed, logged, or sent to the client. Webhook handlers (GitHub/S3/Bedrock/ElevenLabs/Vercel) verify signatures and enforce idempotency/replay protection.
- **Blast radius:** the only file the system overwrites is the approved `skills/**/SKILL.md`, and only after Gate #3, recording the resulting commit SHA in Aurora. No other repo writes. File writes stay workspace-sandboxed; network egress stays allowlisted per the harness guardrails.

## 6. Quality bars

Before any milestone is tagged, all must be green:
- **Type-check:** `tsc --noEmit` clean (TS) and `mypy` clean (Python).
- **Lint/format:** `ruff` (Python) and the project ESLint/Prettier config (TS) clean.
- **Tests:** `pytest` and the TS unit suite pass; **Playwright e2e** passes for every approval-gate and artifact-review flow.
- **DB:** Alembic/migration check passes; no drift.
- **Privacy/domain evals:** the privacy eval suite passes with **CRITICAL and HIGH gates at zero failures** (PII/PHI exposure, claim provenance/accuracy, redaction integrity) before deploy.
- **A11y:** user-facing UI meets **WCAG 2.2 AA** (semantic markup, keyboard operability, correct ARIA) on changed screens.
- **Coverage:** ≥ 80% on new/changed modules; provenance-linking and redaction code require explicit tests.
- **Cost/latency:** LLM pipeline stays within its token/latency budget eval gate; no untracked model-tier upgrades.

## 7. Escalation contract

An autonomous session MUST pause and ask a human when:
- Any of the three approval gates is reached — never self-approve, self-edit-and-approve, or skip a gate.
- A redaction or Guardrails/PII check fails, is ambiguous, or would be bypassed.
- A generated claim cannot be linked to concrete evidence.
- A change would touch scope/non-goals (§2), add a service/dependency, alter storage shape, or modify a webhook/secret/IAM boundary.
- A GDPR data-subject request (erasure/access) or any personal-data handling decision arises.
- The skill-learning graph would overwrite a repo `SKILL.md` (Gate #3) or promote a candidate.
- Quality bars (§6) cannot be met, or a fix would require weakening a safety rail.
- Tests/migrations are red and the fix is non-obvious, or required credentials/permissions are missing.

## 8. Definition of done

v1.0 is shipped only when:
- The full loop runs end-to-end: release trigger → evidence collect/redact/persist → deterministic signals → feature clustering → **Gate #1** → artifact generation (blog/changelog, sales one-pager, social snippets, demo script, audio digest, optional demo video) → claim extraction + evidence linking → deterministic checks + Guardrails → **Gate #2** → optional media (Playwright + ffmpeg + ElevenLabs → S3) → learning signals → skill candidate → **Gate #3** → repo `SKILL.md` replaced with commit SHA recorded in Aurora.
- Every shipped artifact has claim-level provenance traceable to evidence; nothing publishes without its gate.
- All §6 quality bars green on `main`; privacy evals pass CRITICAL/HIGH.
- Dashboard supports release review, feature approval, artifact review, and skill-proposal approval, all keyboard-operable and WCAG 2.2 AA.
- No secrets in code/logs/DB/client; redaction verified on a real release run; GDPR erasure verified across Aurora + S3.
- Runs reproducibly on the GitHub Actions runner with documented env/secrets; no deferred non-goal silently introduced.
