# Tasks — Engagement outcome loop: UTM stamping, engagement ingestion, ROI view

- [x] **T1 — Schema + adapters** `engagement_metrics` migration, Aurora adapter, TS db module; aggregate-only column design; provenance (source, as_of).
- [x] **T2 — UTM stamping at export** Export-time link rewriter on the spec-019 paths; deterministic params from release_run_id + artifact_type; snapshot immutability preserved; unit tests on markdown and HTML link forms.
- [x] **T3 — Ingestion API** `POST /api/releases/{releaseRunId}/engagement` with strict boundary validation, run-scoping check, idempotent upsert on (artifact_id, metric, as_of, source).
- [x] **T4 — CSV upload UI** Upload panel with template, server-side parse/validate, row-level error reporting; a11y per WCAG 2.2 AA; e2e for the upload flow.
- [x] **T5 — ROI surfaces** Cost-vs-engagement per artifact type on the cost page + run totals with cost-per-click; "not yet reported" empty states; tests for partial-data rendering.
