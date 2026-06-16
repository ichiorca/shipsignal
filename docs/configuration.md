# Configuration — release-run skeleton (spec 001)

All secrets come **only** from the environment (GitHub / Vercel / AWS env, or Secrets
Manager in prod). Per the constitution (§5 Safety rails) they are never hardcoded,
committed, logged, or shipped to the client. **None** of these may carry a
`NEXT_PUBLIC_*` prefix — that would leak the value into the browser bundle.

Copy these into a local `.env` (git-ignored) or your Vercel/GitHub-Actions secret
store. There is intentionally no committed `.env.example`: `.env*` is a
harness-protected path so the autonomous session cannot author one.

## Vercel/v0 dashboard + API routes

| Variable | Required by | Purpose |
|---|---|---|
| `DATABASE_URL` | T1, T2, T3, T4 | Aurora PostgreSQL connection string. Route through RDS Proxy / a pooled endpoint — never a raw per-invocation pool. |
| `PGSSLMODE` | T1 | TLS mode for Aurora. Must be `require` or stricter (`verify-full`). TLS is mandatory. |
| `GITHUB_TOKEN` | T3 | Server-only fine-grained token / App installation token used to `workflow_dispatch` the release-run job — **and** to authenticate one-click publish to GitHub Releases (`/api/artifacts/{id}/publish/github-release`). Never sent to the client. |
| `GITHUB_REPO` | T3 | `owner/repo` whose workflow runs release analysis. |
| `GITHUB_WORKFLOW_FILE` | T3 | Workflow filename to dispatch (default `release-run.yml`). |
| `GITHUB_WORKFLOW_REF` | T3 | Git ref the dispatch targets (default `main`). |
| `GITHUB_WEBHOOK_SECRET` | T4 | HMAC secret for the GitHub webhook; verified over the **raw** request body. |
| `SLACK_WEBHOOK_URL` | publish | Optional Slack incoming-webhook for one-click artifact publish (`/api/artifacts/{id}/publish/slack`). Unset ⇒ that route returns 503 (feature off). Server-side only; the URL embeds a credential. Shares the var with the worker's gate notifications — see `docs/distribution.md` / `docs/notifications.md`. |
| `LINKEDIN_ACCESS_TOKEN` | Phase 3 publish | Server-only token for publishing approved `linkedin_post` artifacts to the company page (`/api/artifacts/{id}/publish/linkedin`). **Unset ⇒ dry-run** (the flow runs, nothing is sent). Never sent to the client/logged. |
| `LINKEDIN_ORG_ID` | Phase 3 publish | LinkedIn organization id the post is authored as (company-page target). Required alongside the token for a real send. |
| `X_ACCESS_TOKEN` | Phase 3 publish | Server-only token for publishing approved `x_post` artifacts to X (`/api/artifacts/{id}/publish/x`). **Unset ⇒ dry-run.** Never sent to the client/logged. |
| `PUBLISH_DRY_RUN` | Phase 3 publish | Optional. `1`/`true`/`yes` forces dry-run for ALL channels even when credentials are set (safe demos with real tokens). |
| `PUBLISH_MODE` | Phase 3/4 | `manual` (default) or `scheduled`. Surfaced in Distribute; `scheduled` enables approve-then-schedule (Phase 4). Hacker News is always assisted (no API) — `hackernews_post` is prepared + deep-linked, never auto-posted. |
| `SCHEDULED_PUBLISH_SECRET` | Phase 4 | Shared secret guarding the queue-drain route (`POST /api/internal/scheduled-publishes/run`). **Unset ⇒ the drain route 503s (scheduling executor off).** The `scheduled-publish` GitHub Actions cron sends it as `Authorization: Bearer …` (repo secret), with `APP_BASE_URL` (repo **variable**) as the deployed origin. Server-side only. |

## GitHub Actions worker (Python LangGraph)

| Variable | Required by | Purpose |
|---|---|---|
| `DATABASE_URL` | T5 | Aurora connection the worker writes run status + `langgraph_thread_id` back to. |
| `PGSSLMODE` | T5 | TLS mode (`require`+). |
| `RELEASE_RUN_ID` | T5 | The `release_runs.id` this job advances (passed as a workflow input). |
| `SLACK_WEBHOOK_URL` | spec 020 | Optional Slack incoming-webhook for gate-ready reviewer notifications. Unset = feature fully off (local/dev/CI default). The URL embeds a credential — worker env only, never logged. See `docs/notifications.md`. |

Local-dev / CI note: the unit-test gate (`npm test && pytest -q`) needs **none** of
these — the pure modules under test read no secrets, and the Aurora/GitHub/LangGraph
adapters are only imported by the deploy-time entry points.
