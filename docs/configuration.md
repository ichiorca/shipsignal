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
| `GITHUB_TOKEN` | T3 | Server-only fine-grained token / App installation token used to `workflow_dispatch` the release-run job. Never sent to the client. |
| `GITHUB_REPO` | T3 | `owner/repo` whose workflow runs release analysis. |
| `GITHUB_WORKFLOW_FILE` | T3 | Workflow filename to dispatch (default `release-run.yml`). |
| `GITHUB_WORKFLOW_REF` | T3 | Git ref the dispatch targets (default `main`). |
| `GITHUB_WEBHOOK_SECRET` | T4 | HMAC secret for the GitHub webhook; verified over the **raw** request body. |

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
