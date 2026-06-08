# Tasks — Demo media trigger, broken-step surfacing, and media_assets schema fix

- [ ] **T1 — generate-demo endpoint** `POST /api/features/{featureId}/generate-demo`: zod-validated, 404 on unknown/unapproved feature, reviewer recorded, dispatches the media worker for the feature.
- [ ] **T2 — media_assets schema reconcile** Reversible migration adding `transcript` and aligning artifact/metadata column names to §10.6 (or a documented mapping applied across model/API/UI); backfill existing rows.
- [ ] **T3 — Broken-step capture** Media graph persists the failed step name + status on a node error and stores raw recording and final video separately, rather than failing the entire run opaquely.
- [ ] **T4 — Dashboard broken-step surfacing** Media preview renders per-asset generation/broken state with the broken step name; keyboard-operable, WCAG 2.2 AA.
- [ ] **T5 — e2e test** Playwright e2e proving trigger → broken-step surfaced on failure and final asset playable on success.
