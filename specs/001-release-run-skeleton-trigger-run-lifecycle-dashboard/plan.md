# Plan — Release-run skeleton: trigger → run lifecycle → dashboard

(architecture / approach honoring the constitution)

## Goal

Stand up the minimal end-to-end skeleton so everything downstream can attach to a
`release_run`: create a run (manual compare range **or** GitHub release-tag webhook),
boot a no-op LangGraph thread on the GitHub Actions runner that transitions run
status and persists `langgraph_thread_id`, and list runs on the Vercel dashboard.

## Constitution touchpoints

- **§1 Substrate** — TS (Next.js App Router + React 19) for dashboard/API; Python
  (LangGraph worker) for the job. Orchestration is LangGraph only; the long job runs
  on the GitHub Actions runner, never in the Vercel app.
- **§4 Storage** — `release_runs` lives in Aurora; every row carries `release_run_id`
  (the run's own `id`) as the tenancy key everything downstream references.
- **§5 Safety rails** — webhook handlers verify signatures over the **raw** body and
  enforce delivery-GUID idempotency/replay protection; secrets come only from env and
  never reach the client bundle, logs, or DB.
- **§6 Quality bars** — `tsc`/`mypy`/`ruff`/eslint clean; unit tests green; run-list
  page is keyboard-operable and WCAG 2.2 AA.

## Module layout & key decisions

The hard environment constraint that shapes the design: the unit-test gate
(`npm test && pytest -q`) runs with **native Node TS stripping + `node --test`** (no
bundler) and a **Python interpreter that has pydantic + pytest but not langgraph /
psycopg**. So the security- and correctness-critical logic is factored into pure
modules that the gate can import directly, and the heavy runtime libraries sit behind
thin adapters that are imported **only** by the deploy-time entry points.

TypeScript (Vercel/v0 app):

- `app/lib/env.ts` — server-only env accessor; refuses `NEXT_PUBLIC_*` for secrets.
- `app/lib/aurora.ts` — pooled, TLS-required Aurora client (lazy `pg.Pool`; never a
  raw per-invocation connection). Imported only by route handlers / server components.
- `app/lib/db/releaseRuns.ts` — `release_runs` SQL + row mapping (repository).
- `app/lib/runStatus.ts` — shared run-status state machine (queued→running→completed,
  illegal transitions rejected). **Pure → unit-tested.**
- `app/lib/releaseInput.ts` — zod schema + validator for the create-run body.
  **Pure → unit-tested.**
- `app/lib/githubWebhook.ts` — HMAC-SHA256 verify over raw body + delivery-GUID
  dedupe. **Pure → unit-tested (the 401 / replay ACs).**
- `app/lib/githubDispatch.ts` — `workflow_dispatch` caller (server-side token only).
- `app/api/releases/route.ts` — `POST` create run + `GET` list (T3).
- `app/api/webhooks/github/route.ts` — release-tag webhook (T4).
- `app/components/RunListTable.ts` — pure presentational table authored with
  `createElement` (no JSX) so it renders under `node --test` for the axe/structure
  a11y check; consumed by the JSX page.
- `app/page.tsx` — async Server Component run list (T6 entry point).

Python (LangGraph worker, `worker/`):

- `release_worker/status.py` — `RunStatus` + transition rules (pure, mirrors the TS
  state machine). **Unit-tested.**
- `release_worker/state.py` — pydantic graph-state model. **Unit-tested.**
- `release_worker/nodes.py` — the pass-through node logic (pure function over state +
  a repository protocol). **Unit-tested with an in-memory fake.**
- `release_worker/repository.py` — `ReleaseRunRepository` Protocol + `InMemoryRepo`.
- `release_worker/aurora_repository.py` — psycopg impl (imported only at runtime).
- `release_worker/graph.py` — LangGraph wiring (imported only at runtime).
- `release_worker/__main__.py` — entry point the Actions job invokes.

Storage (T2):

- `db/migrations/versions/0001_release_runs.py` — real Alembic DDL for `release_runs`
  per PRD §10.1. Migration check wired into `.github/workflows/ci.yml`.

CI / runner (T5):

- `.github/workflows/release-run.yml` — hardened runner, OIDC role assumption, runs
  the worker which flips status running→completed and writes `langgraph_thread_id`.
- `.github/workflows/ci.yml` — unit tests + alembic migration check.

## Test strategy

- TS: `node --test tests/**/*.test.ts` (native stripping) covers webhook
  signature/replay, release-input validation, the status machine, and the run-list
  table's semantic markup via `react-dom/server` + jsdom/axe.
- Python: `pytest` over `worker/tests` (pythonpath-injected, no install needed)
  covers the status machine, pydantic state, and the pass-through node against an
  in-memory repository.
- The AC tests exercise the same public surface the operator/runtime invokes (the
  webhook verifier the route calls; the node the graph calls), not private helpers.
