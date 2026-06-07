# PR/issue/docs collection + deterministic code-signal extractors

> PRD anchors: 6.1 Evidence sources; 6.2 Deterministic code signal extractors; 6.3 Evidence item contract; 5.2 Release intelligence graph; 1.1 Core goals (#3)

## Summary

Add collect_prs_and_issues and collect_docs_changes, then the deterministic extractors that turn diffs into typed, user-facing change signals (UI strings, routes, flags, schema, public API, tests, docs delta). Dashboard shows evidence categorized by signal type with confidence.

## Acceptance criteria

- Each extractor produces correctly-typed evidence on fixture diffs (e.g. a new button label → ui_string_change; a new route file → route evidence) with deterministic output across runs.
- PR/issue/docs text is redacted before persistence; no raw PII in Aurora.
- Evidence carries evidence_type, confidence, and source provenance metadata.
- Extractors have AAA unit tests covering empty/boundary/no-change inputs; ≥80% coverage.
- Categorized view meets WCAG 2.2 AA.
