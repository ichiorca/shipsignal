# Demo media trigger, broken-step surfacing, and media_assets schema fix

> PRD anchors: 14.5 Media APIs (generate-demo); 16.3 Demo-video constraints (fail gracefully, show broken step; store raw + final separately; preserve transcript); 10.6 media_assets; 13.1 Media preview

## Summary

The media generation graph is implemented but cannot be launched from the product and fails opaquely. There is no per-feature trigger endpoint, a failed media step fails the whole run instead of surfacing which step broke, and the `media_assets` table drops the spec-required `transcript` column and renames others. Close these so a reviewer can generate, observe, and recover a demo video for an approved feature.

## Acceptance criteria

- `POST /api/features/{featureId}/generate-demo` (§14.5) triggers the media graph for an approved feature: zod-validated, 404 on unknown/unapproved feature, reviewer recorded, dispatches the worker.
- A failed media step is captured and surfaced in the dashboard (broken step name + status) instead of failing the whole run silently (§16.3); raw recording and final video are stored separately and the transcript/narration script are preserved.
- `media_assets` is reconciled to PRD §10.6: `transcript` column added; artifact linkage and metadata column names match the spec (or a documented, consistent mapping is applied app-wide); migration is reversible with backfill.
- Media preview shows per-asset generation/broken state and plays the final asset; keyboard-operable, WCAG 2.2 AA.
- Existing validated-click-path safety (deterministic selectors, data-testid) is unchanged.
