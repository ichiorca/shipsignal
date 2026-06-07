# Tasks — Release-run skeleton: trigger → run lifecycle → dashboard

- [x] **T1 — Scaffold Next.js App Router app + Aurora client** Create the Vercel/v0 Next.js app shell and a server-only Aurora PostgreSQL client (TLS required, IAM/env-sourced creds, RDS-Proxy/pooled access, no per-invocation raw pools). No secrets in NEXT_PUBLIC_*.
- [x] **T2 — Alembic migration for release_runs** Create release_runs table per §10.1 (id, repo, base_ref, head_ref, trigger_type, status, langgraph_thread_id, run_metadata_json, started_at, completed_at). Add migration check to CI.
- [x] **T3 — API route to create a manual release run** POST /api/releases validates {repo, base_ref, head_ref} with zod, inserts a release_run (status=queued), and triggers a GitHub Actions workflow_dispatch. Server-side GitHub token only.
- [x] **T4 — GitHub release-tag webhook handler** Webhook route verifies HMAC-SHA256 over the RAW body, dedupes on delivery GUID (idempotent), responds 2xx <10s, then creates a release_run for the tag's compare range. Reject unsigned/replayed deliveries.
- [x] **T5 — GitHub Actions workflow + no-op LangGraph graph** Workflow checks out repo, runs a Python LangGraph worker exposing release_intelligence_graph with a single pass-through node that sets status running→completed and writes langgraph_thread_id back to Aurora. Hardened runner, OIDC role assumption.
- [x] **T6 — Dashboard run list page** Server Component lists release_runs with status; keyboard-operable, semantic markup, WCAG 2.2 AA. No PII rendered (none exists yet).
