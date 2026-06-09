# Per-run artifact-type selection

> PRD anchors: 8.1 initial artifact types (the closed set of six this spec selects from); 5.3 content generation graph (parallel per-type generation is the seam the selection plugs into); 14.1 release APIs (run-creation payload gains the selection); 17.1 + spec 011 (token budgets / cost — deselected types must incur zero model spend)
>
> No constitutional touchpoints: no new egress, secrets, services, or storage shapes. Purely narrows existing behavior.

## Summary

Every run generates all six artifact types regardless of need. A small internal patch release that only warrants a changelog entry still pays Bedrock tokens for a blog post, sales one-pager, LinkedIn post, demo script, and audio digest — and a reviewer still has to reject five unwanted drafts at Gate #2 (polluting the rejection-pattern signals the skill-learning graph mines). This spec makes the artifact set a per-run choice: checkboxes on the manual-run form, a configured default for webhook-triggered runs, persisted on the run row, and honored by the content generation graph so deselected types produce zero model calls. Downstream surfaces (Gate #2 review, evals, media) handle subsets gracefully. One cross-feature dependency is surfaced in the UI: demo media requires an approved `demo_script`, so deselecting it disables demo generation for that run.

## Acceptance criteria

- `release_runs` gains an `artifact_types` column (validated list drawn from the six §8.1 types; non-empty; migration backfills existing rows with all six). The selection is immutable after run creation.
- `POST /api/releases` accepts an optional `artifact_types` array, boundary-validated (unknown type → 4xx user-safe error; empty array → 4xx; omitted → default set). The manual-run form on `/` shows six labelled checkboxes, all checked by default, keyboard-operable, WCAG 2.2 AA.
- GitHub-webhook-triggered runs use a configured default (`ARTIFACT_TYPES_DEFAULT` env, comma-separated, validated at startup; unset → all six).
- The content generation graph reads the run's selection and fans out only the selected types; claims extraction, evidence linking, deterministic checks, and Guardrails run unchanged on what is generated. Deselected types: zero Bedrock calls, zero rows in `artifacts`, zero entries in `model_call_telemetry`.
- Gate #2 review and draft pages render only the run's selected types (no empty groups for unselected ones); run-level approve-all/reject-all operates over the generated subset.
- Eval metrics tolerate subsets: per-type metrics are computed only over generated types; no division-by-zero; media_success_rate is reported as not-applicable when `demo_script` was deselected.
- If `demo_script` is not selected, the demo-media trigger (`/api/features/{featureId}/generate-demo`) returns a 409 with a user-safe explanation, and the media page states why demo generation is unavailable for the run.
- Tests: validation boundaries (empty, unknown type, single type, all types), zero-spend assertion for deselected types, webhook default path, Gate #2 subset rendering, eval subset math, demo-script dependency; ≥80% coverage on changed modules.
