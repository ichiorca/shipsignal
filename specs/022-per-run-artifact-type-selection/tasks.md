# Tasks — Per-run artifact-type selection

- [ ] **T1 — Schema + API validation** `artifact_types` migration with backfill; `POST /api/releases` accepts and validates the array; run detail API returns it.
- [ ] **T2 — Run form + webhook default** Checkbox group on the manual-run form (a11y per WCAG 2.2 AA); `ARTIFACT_TYPES_DEFAULT` for webhook-created runs, validated at startup.
- [ ] **T3 — Worker honors selection** Content generation graph fans out only selected types (Pydantic-validated when read from the run row); zero model calls / telemetry rows for deselected types.
- [ ] **T4 — Subset-aware surfaces** Gate #2 review + drafts pages render the subset; eval metrics handle absent types; demo-media trigger 409s without `demo_script` with clear UI messaging.
- [ ] **T5 — Tests** Boundary validation, zero-spend, webhook default, subset rendering, eval math, demo dependency; e2e for run creation with a subset through Gate #2.
