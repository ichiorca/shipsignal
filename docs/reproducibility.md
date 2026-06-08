# Reproducing the full loop on a clean runner (spec 012, T4)

> Constitution §8 (Definition of Done): "Runs reproducibly on the GitHub Actions runner with
> documented env/secrets." This is that documentation — the complete env/secret surface for
> all four graphs plus the steps to drive one release run end-to-end through the three gates.

The loop is four LangGraph phases, each dispatched to the `release-run.yml` Actions workflow
with `graph=<phase>` (see `.github/workflows/release-run.yml`). The heavy work (diff analysis,
Playwright, ffmpeg, Bedrock) runs **only** on the runner — never in the Vercel app
(constitution §1). Each phase resumes on the **same** per-`(run, phase)` thread the worker
derives in `loop_orchestration.thread_id_for`, so a resume continues the halted graph rather
than forking it (PRD §5.6).

```
release_intelligence → Gate #1 → content_generation → Gate #2 → media_generation → skill_learning → Gate #3
```

## Secrets vs. vars

All secrets come **only** from the environment (GitHub Actions secrets / Vercel / AWS, or
Secrets Manager in prod). Per constitution §5 they are never hardcoded, committed, logged, or
shipped to the client, and **none** may carry a `NEXT_PUBLIC_*` prefix. AWS API credentials are
**not** stored at all — the runner assumes a role via OIDC (`aws-actions/configure-aws-credentials`),
so there are no long-lived AWS keys. There is intentionally no committed `.env.example`: `.env*`
is a harness-protected path.

In the table below, **secret** = GitHub Actions *secret* (sensitive); **var** = GitHub Actions
*variable* (non-sensitive config, e.g. a bucket name or model id).

## Required environment — by graph

| Variable | Kind | Graphs | Purpose |
|---|---|---|---|
| `DATABASE_URL` | secret | all | Aurora DSN via RDS Proxy / pooled endpoint. Worker enforces TLS. |
| `PGSSLMODE` | var | all | TLS mode — `require` or stricter (`verify-full`). Mandatory. |
| `AWS_REGION` | secret/var | all | Region for the OIDC-assumed role, Bedrock, and S3. |
| `AWS_RELEASE_RUN_ROLE_ARN` | secret | all | Role the runner assumes via OIDC (no static keys). |
| `BEDROCK_MODEL_ID` | var | intel, content, skill | Default Converse model id (config, not a secret). |
| `BEDROCK_GUARDRAIL_ID` | var | intel, content, skill, media | Published Guardrail id — **mandatory**; the client refuses to run without it. |
| `BEDROCK_GUARDRAIL_VERSION` | var | intel, content, skill, media | Published Guardrail version. |
| `EVIDENCE_BUCKET` | var | intel | Private S3 bucket for redacted evidence blobs. |
| `MEDIA_BUCKET` | var | media | Private S3 bucket for generated media/audio. |
| `GITHUB_TOKEN` | secret | intel | Read-only token for the compare/PR/issue collectors. Server-side only. |
| `GITHUB_SHA` | (auto) | skill | Commit a skill candidate is drafted against (Actions sets `github.sha`). |
| `ELEVENLABS_API_KEY` | secret | media | TTS `xi-api-key`. Server-side only — never `NEXT_PUBLIC_*`. |
| `ELEVENLABS_VOICE_ID` | var | media | Narration voice (config, not hardcoded). |
| `DASHBOARD_BASE_URL` | var | intel, content, skill | Base URL embedded in each gate's interrupt payload. |

### Optional / tunable (have safe defaults)

| Variable | Default | Purpose |
|---|---|---|
| `BEDROCK_MODEL_TIER_CHEAP` / `_STANDARD` / `_FRONTIER` | per-tier id in `model_routing` | Pin a tier's model id so an upgrade is a tracked config change (spec 011). |
| `TOKEN_BUDGET_PER_CALL_MAX` / `TOKEN_BUDGET_PER_RUN_MAX` | 60k / 1.5M | Token-budget caps; an overrun fails the run (spec 011). |
| `ELEVENLABS_MODEL_ID` | `eleven_multilingual_v2` | TTS model id. |
| `ELEVENLABS_OUTPUT_FORMAT` | `mp3_44100_128` | TTS output format. |
| `ELEVENLABS_MAX_CONCURRENCY` | tier cap | Concurrent TTS calls (kept below the subscription cap). |
| `DEMO_FIXTURE_BASE_URL` | — | Synthetic demo app the Playwright click-path runs against (no real PII). |
| `MEDIA_WORK_DIR` | temp dir | Scratch dir for audio/video assembly on the runner. |
| `FFMPEG_BIN` | `ffmpeg` | ffmpeg binary path on the runner. |
| `SKILLS_ROOT` | repo root | Root the repo `skills/**/SKILL.md` candidate is read/written under. |

The local unit-test gate (`npm test && pytest -q`) needs **none** of these — the pure modules
under test read no secrets; the Aurora/GitHub/Bedrock/S3/ElevenLabs adapters are imported only
by the runtime entry point (`python -m release_worker`).

## Driving one run end-to-end

1. **Seed** a `release_runs` row (via the dashboard's release-input route) → get `release_run_id`.
2. **Phase 1** — dispatch `release-run.yml` with `graph=release_intelligence` and the
   `release_run_id`. The worker collects/redacts/persists evidence, builds the feature manifest,
   and **halts at Gate #1**. It writes the derived `langgraph_thread_id` back to Aurora.
3. **Gate #1** — a reviewer approves the manifest in the dashboard
   (`/releases/{id}/review`). The resume route dispatches `graph=release_intelligence`,
   `resume_decision=approved`, and the persisted `thread_id`; the worker continues the **same**
   thread past the gate.
4. **Phase 2 + Gate #2** — dispatch `graph=content_generation` (drafts → claims → checks →
   Gate #2). Review at `/releases/{id}/artifacts/review`; resume with `graph=content_generation`.
   A blocked unsupported-claim artifact can never reach `approved` (constitution §5).
5. **Phase 3** — dispatch `graph=media_generation`. No gate (its demo_script is already
   Gate#2-approved); it runs straight through to S3.
6. **Phase 4 + Gate #3** — dispatch `graph=skill_learning` (signals → candidate → Gate #3).
   Review at `/releases/{id}/skills/review`; resume with `graph=skill_learning` and the
   `reviewer`. On **approve** the worker performs the single repo `SKILL.md` write and records
   the commit SHA in Aurora (constitution §5 blast radius); on **reject** it records a cooldown.

Every dispatch is idempotent at the `(run, phase)` level: a re-dispatch resumes the same
checkpointed thread, and transient Bedrock/GitHub/S3 blips are retried with backoff
(`transient_retry`, spec 012 T2) rather than wedging the run.

See `docs/configuration.md` for the dashboard/API-route env (spec 001) and the constitution
(`memory/constitution.md` §5/§8) for the safety rails these steps honor.
