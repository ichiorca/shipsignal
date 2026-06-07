# Release-run skeleton: trigger → run lifecycle → dashboard

> PRD anchors: 0. Executive Summary; 3. High-Level Architecture; 3.1 Runtime split; 5.1 Graphs; 10.1 Release and evidence tables; 1.1 Core goals (#1)

## Summary

Stand up the minimal end-to-end skeleton: a release run can be created (manual compare range or GitHub release-tag/workflow_dispatch), the GitHub Actions runner boots a no-op LangGraph thread that transitions run status, and the Vercel dashboard lists runs. Everything downstream attaches to this run.

## Acceptance criteria

- Creating a manual run inserts a release_run and dispatches the Actions job; status transitions queued→running→completed and is visible on the dashboard.
- A release-tag webhook with a valid signature creates exactly one run; an invalid signature is rejected with 401 and a replayed delivery GUID is ignored (no duplicate run).
- langgraph_thread_id is persisted on the run after the graph starts.
- No secret appears in client bundles, logs, or DB; tsc/mypy/ruff/eslint clean; migration check passes.
- Run-list page passes axe/keyboard checks (WCAG 2.2 AA).
