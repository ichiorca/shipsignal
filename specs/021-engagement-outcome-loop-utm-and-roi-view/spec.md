# Engagement outcome loop: UTM stamping, engagement ingestion, ROI view

> PRD anchors: 17.1 product-quality metrics (extends the table with outcome metrics); 10.7 evaluation tables; Phase 5 "more advanced evaluation dashboards"; 1.1 goal 8 (review signals drive skill improvement — engagement is the natural next signal source, kept out of v1 scope but the data model must not preclude it)
>
> Depends on: spec 019 (export is the surface where UTM stamping happens; without export there is no instrumented content in the wild).
>
> GDPR rails are load-bearing here: this spec ingests **aggregate counts only** (views, clicks, conversions per artifact). No user-level events, no tracking pixels served by this app, no cookies, no fingerprinting (memory/rules/domain-gdpr-rules.md). If a future version wants user-level analytics, that is a separate spec and a §7 escalation.

## Summary

The system measures generation quality (unsupported-claim rate, edit distance) and cost per run, but not whether the content did anything — there is no way to say "this release's blog post cost $0.84 to generate and drove 1,200 visits." This spec closes the loop with the smallest GDPR-safe footprint: (a) stamp outbound links in exported artifacts with deterministic UTM parameters tying traffic back to the release run and artifact type; (b) ingest aggregate engagement numbers per artifact via an authenticated API and a CSV upload on the dashboard (manual at first — analytics-platform connectors are deferred); (c) show cost-vs-outcome on the release detail and cost pages, turning the cost dashboard from "what we spent" into "what we got". Feeding engagement into the skill-learning graph is explicitly deferred, but engagement rows are keyed so it becomes possible later.

## Acceptance criteria

- Exported markdown/HTML (spec 019 paths) has hyperlinks stamped with `utm_source=shipsignal`, `utm_medium={artifact_type}`, `utm_campaign={release_run_id}`; stamping is deterministic (same artifact → same URLs), applies only to absolute http(s) links, and never alters link text or non-link content. The approved snapshot itself is NOT mutated — stamping happens at export time.
- New `engagement_metrics` table (migration + Aurora adapter, both TS read side and schema): release_run_id, artifact_id, metric (`views` | `clicks` | `conversions`), value (non-negative integer), as_of date, source (`manual_csv` | `api`), created_at. Aggregates only — the schema has no column that could hold user-level data.
- `POST /api/releases/{releaseRunId}/engagement` accepts a validated batch of aggregate rows (boundary-validated, 4xx with user-safe errors on bad shape, artifact ids must belong to the run — cross-run bleed rejected).
- Dashboard: a CSV upload panel on `/releases/[id]/cost` (or a new `/releases/[id]/outcomes` section) with client-side template download and server-side parsing/validation; keyboard-operable, WCAG 2.2 AA.
- ROI view: release detail and cost pages show, per artifact type, generation cost (from existing `model_call_telemetry`) next to ingested engagement; run-level totals include cost-per-click when both sides exist; missing engagement renders as "not yet reported", never as zero.
- No PII anywhere in the path: tests assert the ingestion endpoint rejects rows with unexpected fields, and that nothing user-level can be persisted.
- Tests: UTM stamping idempotency and link-only scope, cross-run artifact rejection, CSV happy path + malformed rows, ROI rendering with partial data, ≥80% coverage on new modules.
