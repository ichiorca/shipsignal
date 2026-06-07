# Tasks — PR/issue/docs collection + deterministic code-signal extractors

- [x] **T1 — collect_prs_and_issues node** Fetch PR metadata (title/body/labels/reviewers/linked issues) and linked issues via GitHub API; treat all text as untrusted; redact before persist.
- [x] **T2 — collect_docs_changes node** Detect docs/release-note/API-reference changes in the diff and capture deltas as evidence.
- [x] **T3 — Lightweight deterministic extractors** Implement extract_ui_strings, extract_routes, extract_feature_flags, extract_schema_changes, extract_public_api_changes, extract_tests, extract_docs_delta; each emits typed evidence_type + confidence per §6.3. Pure functions, heavily unit-tested.
- [x] **T4 — Wire extractors into extract_code_signals node + persist** Run extractors over collected diffs, redact, and persist typed evidence_items with metadata (pr_number, commit_sha, line_range).
- [x] **T5 — Dashboard categorized signals view** Group evidence by evidence_type with counts and confidence; keyboard-operable filters, semantic table markup.
