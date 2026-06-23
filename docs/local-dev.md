# Running ShipSignal locally (Docker + LocalStack)

This stands up the **real** integration paths — not the in-memory unit-test fakes —
against local infrastructure:

| Concern | Local backing | How |
|---|---|---|
| Aurora PostgreSQL + pgvector | `pgvector/pgvector:pg16` container, **TLS on**, host port **5434** | `local/docker-compose.yml` |
| S3 (evidence/media) | LocalStack | `AWS_ENDPOINT_URL` → boto3 |
| SNS (webhooks) | LocalStack | `AWS_ENDPOINT_URL` |
| Bedrock Converse + Guardrails | **LocalStack Pro** (emulated) | `AWS_ENDPOINT_URL` + `LOCALSTACK_AUTH_TOKEN` |
| GitHub API | **real** github.com | `GITHUB_TOKEN` + `GITHUB_REPO` |
| ElevenLabs TTS | **real** api.elevenlabs.io | `ELEVENLABS_API_KEY` |
| Next.js dashboard + worker | run on the **host** | `npm run dev` / `python -m release_worker` |

> Why no Docker for the app/worker themselves? The worker pulls in Playwright + ffmpeg
> and runs as a short-lived process; keeping it on the host matches the GitHub Actions
> execution model and keeps the loop fast. Only the stateful infra is containerized.

---

## Prerequisites

- **Docker Desktop** (Compose v2).
- **Node 22** and **Python 3.11** on the host.
- **LocalStack Pro auth token — OPTIONAL.** The default stack uses the **free community**
  image (S3 + SNS), which is enough to run and test the whole **dashboard**. A Pro token
  (https://app.localstack.cloud → Auth Token) is only needed to run the **worker generation
  graphs** locally (community LocalStack does not emulate Bedrock). To enable it, set in
  `local/dev-env`: `LOCALSTACK_IMAGE=localstack/localstack-pro:latest`,
  `LOCALSTACK_SERVICES=s3,sns,bedrock`, and `LOCALSTACK_AUTH_TOKEN=...`.
- For the media graph only: **ffmpeg** on PATH and **Playwright browsers**
  (`python -m playwright install chromium`).

---

## Quickstart

```powershell
# 1. Create your env file. For DASHBOARD-ONLY testing the defaults work as-is — no secrets
#    needed (free community LocalStack, publishing in dry-run, scheduling on).
Copy-Item local/dev-env.sample local/dev-env
#    -> for the worker graphs only: edit LOCALSTACK_* (Pro), GITHUB_*, ELEVENLABS_*

# 2. Install the migration deps (enough for dashboard-only; add worker/requirements.txt
#    only if you'll run the generation graphs locally).
pip install -r db/requirements.txt

# 3. Bring up Postgres + LocalStack, create buckets, run migrations, and seed the canonical
#    skill library (skills/**/SKILL.md -> skill_repo_snapshots, so the Skills page is populated).
pwsh local/bootstrap.ps1        # bash/WSL: bash local/bootstrap.sh

# 4. If the bootstrap printed a Guardrail id, paste it into local/dev-env
#    (BEDROCK_GUARDRAIL_ID=...), then continue.

# 5. Load env into your current shell, then start the dashboard.
Get-Content local/dev-env | ForEach-Object {
  if ($_ -and -not $_.StartsWith('#') -and $_.Contains('=')) {
    $i = $_.IndexOf('='); Set-Item "Env:$($_.Substring(0,$i).Trim())" $_.Substring($i+1).Trim()
  }
}
npm install
npm run dev     # http://localhost:3000
```

Dashboard pages that read the database (release list, feature review, approval gates)
now work end-to-end against local Postgres.

> Tip: with the dashboard up, use the **Load sample release** button (home page, "Try it with
> sample data") to seed a complete demo release — features, approved artifacts with
> claims/evidence, engagement metrics, and eval/cost rows — without running the worker. Handy for
> exercising the review / ROI / trends screens. It POSTs to `/api/demo/seed` and links you
> straight to the seeded run.

> **Reference skills** (not demo data): the bootstrap seeds the canonical `skills/**/SKILL.md`
> library into `skill_repo_snapshots` so the Skills page reflects the real playbooks on a fresh
> DB. The repo files remain the source of truth (constitution §2); this is the provenance mirror
> the worker would otherwise only populate during a content run. Re-run it standalone after editing
> or adding a skill:
>
> ```powershell
> python scripts/seed_reference_skills.py        # needs DATABASE_URL + psycopg on the path
> ```

---

## Testing publishing + scheduling locally (Path B / Phases 3–4)

The default `local/dev-env` is wired for this with **no external accounts**:

- **`PUBLISH_DRY_RUN=1`** — approving an `x_post`/`linkedin_post` and clicking **Publish to X /
  LinkedIn** runs the whole flow and shows *"Dry run: would post … nothing sent"*. No real
  tokens, no real posts. (Set `LINKEDIN_*` / `X_ACCESS_TOKEN` and `PUBLISH_DRY_RUN=0` to send
  for real — X's API is paid, LinkedIn needs an approved app + page token.)
- **`PUBLISH_MODE=scheduled`** — the **Schedule** controls appear on the Gate #2 review and the
  standalone artifact page, and the **Distribute → Scheduled posts** queue is live.

Exercise the scheduler end-to-end without waiting for the cron:

```powershell
# 1. Seed data + approve a post, then schedule it (UI), OR just have a pending schedule.
# 2. Manually fire the drain the GitHub Actions cron would run (POST, with the bearer secret):
curl -X POST http://localhost:3000/api/internal/scheduled-publishes/run `
  -H "Authorization: Bearer local-dev-drain-secret"
# -> {"ok":true,"processed":N,"sent":N,"failed":0,"dryRun":N}
```

Then refresh **Distribute → Scheduled posts**: due rows flip `pending → sent` (as dry-runs).
A post you reject/edit after scheduling is cancelled and never ships (the §5 safety check).

> `SCHEDULED_PUBLISH_SECRET` gates that route — unset it to get a `503` (the feature is off);
> a wrong/missing bearer is a `401`.

---

## The `DATABASE_URL` dual-form gotcha

The same database needs **two URL spellings** because the consumers use different drivers:

| Consumer | Required form | Reason |
|---|---|---|
| Next.js app (`pg`) | `postgresql://…` | node-postgres; uses `PGSSLMODE` for TLS |
| Worker (`psycopg.connect`) | `postgresql://…` | libpq URI; auto-appends `sslmode=require` |
| Alembic (`SQLAlchemy`) | `postgresql+psycopg://…` | selects the psycopg3 dialect (psycopg2 isn't installed) |

`local/dev-env` stores the **plain** `postgresql://` form (app + worker). The bootstrap
derives the `+psycopg` form on the fly when it runs Alembic — you don't maintain two vars.

TLS note: the container serves a self-signed cert. `sslmode=require` / `PGSSLMODE=require`
**use** TLS but do **not** verify the chain, so the self-signed cert is accepted. Do not
set `verify-full` locally (it would need the CA). `disable` is rejected by the code.

---

## Running the worker graphs

The worker runs on the host. It needs `local/dev-env` loaded and `worker/src` on the
Python path. The four graphs run as separate invocations (mirroring Actions):

```powershell
$env:PYTHONPATH = "worker/src"

# Release intelligence: GitHub diffs/PRs -> redact -> S3+Aurora -> features -> Gate #1
python -m release_worker --release-run-id <uuid> --graph release_intelligence

# Resume past a gate after approving in the dashboard (same thread is durable in Aurora):
python -m release_worker --release-run-id <uuid> --graph release_intelligence --resume-decision approved

# Content generation -> Gate #2
python -m release_worker --release-run-id <uuid> --graph content_generation

# Media generation (needs ElevenLabs + Playwright + ffmpeg; no gate)
python -m release_worker --release-run-id <uuid> --graph media_generation

# Skill learning -> Gate #3
python -m release_worker --release-run-id <uuid> --graph skill_learning
```

A `release_runs` row must exist first (the dashboard's release-input route creates one,
or insert one manually via `psql`). The graphs are scoped by `release_run_id`.

---

## Known gaps & caveats

### 1. UI presigned-S3 links (LocalStack-aware)
`app/lib/s3Presign.ts` now supports an **endpoint override**: when `AWS_ENDPOINT_URL_S3`
(or `AWS_ENDPOINT_URL`) is set, it signs **path-style** (`http://localhost:4566/<bucket>/<key>`)
against the LocalStack host instead of the AWS virtual-hosted endpoint. The evidence/media
route handlers read those env vars, so **"view evidence" / "play media" links work against
LocalStack** out of the box (`local/dev-env.sample` sets `AWS_ENDPOINT_URL`). In prod
neither var is set, so the URL stays the default `https://<bucket>.s3.<region>.amazonaws.com`
— behavior there is unchanged.

> Note: this requires the Next.js server process to have `AWS_ENDPOINT_URL` in its env
> (load `local/dev-env` into the shell that runs `npm run dev`). The browser never sees it.

### 2. Bedrock caveats (LocalStack Pro)
- LocalStack emulates Bedrock via a local model backend (Ollama) spun up in a sibling
  container — the **first** Converse call may be slow while a model is pulled, and the
  exact model ids (`anthropic.claude-3-5-sonnet…`, `amazon.titan-embed-text-v2`) may be
  mapped to a local substitute. Output quality/shape will not match real Bedrock.
- The code attaches `guardrailConfig` to **every** Converse call and requires
  `BEDROCK_GUARDRAIL_ID`/`_VERSION`. If your LocalStack build doesn't implement
  `create-guardrail` / `guardrailConfig`, you have two options:
  1. Point only the model calls at real AWS: in `local/dev-env`, leave S3/SNS on
     LocalStack but override **just** bedrock back to AWS with
     `AWS_ENDPOINT_URL_BEDROCK_RUNTIME=https://bedrock-runtime.us-east-1.amazonaws.com`
     and supply real AWS creds + a real published Guardrail id.
  2. Check the LocalStack Bedrock docs for the current Guardrails support level.

### 3. SNS / webhook signature verification
The webhook routes verify SNS/provider signatures over the raw body. Driving them
locally is non-trivial; use the repo's webhook-test skills
(`/github-webhook-test`, `/s3-webhook-test`, etc.) which craft correctly-signed
payloads against the local handlers.

### 4. Non-AWS externals are real
GitHub and ElevenLabs calls hit the real services and consume real quota/credits.
Scope your `GITHUB_REPO` to a test repo and watch ElevenLabs usage.

---

## Integration tests (real infra, no mocks)

These exercise the actual integration seams against the running local stack — not the
in-memory fakes the unit gate uses. They are kept out of the unit gate (CI stays
infra-free): the Python ones live outside `testpaths`, the TS ones use a `*.integration.ts`
suffix the unit glob ignores.

**Prereqs:** the stack is up + bootstrapped (`pwsh local/bootstrap.ps1`), `local/dev-env`
loaded into your shell, and `pip install -r worker/requirements.txt`.

```powershell
$env:RUN_INTEGRATION = "1"

# TypeScript: app Aurora client over TLS + pgvector; presigned-GET S3 round-trip.
npm run test:integration

# Python: worker S3 writer, Aurora+pgvector, durable checkpointer resume.
pytest worker/integration_tests
```

| Test | Real seam it proves |
|---|---|
| `tests/integration/aurora.integration.ts` | App `pg` pool negotiates **TLS**; pgvector extension present (migrations applied) |
| `tests/integration/s3Presign.integration.ts` | App presigned-GET (endpoint override) **retrieves a real object** from LocalStack S3 |
| `worker/integration_tests/test_s3_media_store_integration.py` | `S3MediaStore` uploads + reads back from LocalStack (SSE, run-scoped key) |
| `worker/integration_tests/test_aurora_pgvector_integration.py` | `connect_from_env` TLS + cosine `<=>` nearest-neighbour query |
| `worker/integration_tests/test_checkpointer_integration.py` | LangGraph **durable resume across separate savers** via Postgres |

**Externally-billed seams** need an extra opt-in flag each (they hit real GitHub /
ElevenLabs, or LocalStack Pro Bedrock):

```powershell
$env:RUN_BEDROCK_INTEGRATION = "1"        # + BEDROCK_MODEL_ID
$env:RUN_GITHUB_INTEGRATION  = "1"        # + GITHUB_TOKEN/REPO/BASE_REF/HEAD_REF
$env:RUN_ELEVENLABS_INTEGRATION = "1"     # + ELEVENLABS_API_KEY/VOICE_ID (uses credits)
pytest worker/integration_tests
```

Each test **skips** (never fails) when its required env/flag is absent, so a partial
local setup runs only the seams you've configured.

## Browser end-to-end tests (agent-browser)

`tests/e2e/*.e2e.ts` drive a **real headless Chrome** against the **running** dashboard via
the [agent-browser](https://github.com/vercel-labs/agent-browser) CLI — exercising the full
chain browser → Next.js UI → API route → Aurora, with no mocks:

- `dashboard.e2e.ts` — home page + create-run form, creating a run end-to-end (incl. the
  soft-success path), the server validation error surfacing in the UI, and the run-detail
  breadcrumb + section nav.
- `gateFlow.e2e.ts` — the **Gate #1 approval flow**. It seeds a run + a pending feature
  directly via SQL (a deterministic fixture — no GitHub/Bedrock/worker needed), then drives
  the browser to verify the gate is disabled until a reviewer is named, that **Approve opens
  the confirmation dialog** stating the consequence, that **Cancel dismisses without
  resuming**, and that **confirming records the decision in Aurora**. This file additionally
  needs `DATABASE_URL` (load `local/dev-env`) for its seed/assert queries.

**Prereqs:**
1. Local stack up + bootstrapped (Postgres has the schema): `pwsh local/bootstrap.ps1`.
2. The dashboard running with `local/dev-env` loaded: `npm run dev` (→ http://localhost:3000).
3. agent-browser installed:
   ```bash
   npm i -g agent-browser
   agent-browser install            # downloads Chrome for Testing (one-time)
   ```

**Run:**
```bash
RUN_E2E=1 npm run test:e2e                       # bash / WSL
$env:RUN_E2E="1"; npm run test:e2e               # PowerShell
```

Knobs: `E2E_BASE_URL` (default `http://localhost:3000`), `AGENT_BROWSER_BIN` (default
`agent-browser` on PATH — set this to the `.cmd` path on native Windows, or run under WSL).
Without `RUN_E2E=1`, or if the CLI isn't installed, every e2e test **skips** (so the unit
gate and CI are unaffected).

## Teardown

```powershell
# Stop containers, keep data:
docker compose -f local/docker-compose.yml down
# Stop and wipe Postgres + LocalStack volumes:
docker compose -f local/docker-compose.yml down -v
```

`local/dev-env` and the `.localmedia/` scratch dir are git-ignored; delete the `local/`
tree to remove the setup entirely (no app/worker source depends on it).
