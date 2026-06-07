# Evidence collection with redact-before-persist (git diff)

> PRD anchors: 4. Core Product Flow; 5.2 Release intelligence graph; 6.1 Evidence sources; 6.3 Evidence item contract; 10.1 Release and evidence tables; 1.1 Core goals (#2)

## Summary

First real release_intelligence_graph slice: load the release boundary, collect the git diff, redact/normalize every excerpt BEFORE it enters S3/Aurora/state, then persist redacted evidence to Aurora and raw bundles to S3 by key. Dashboard shows redacted evidence for a run.

## Acceptance criteria

- Given a fixture diff containing an email/API key, the persisted Aurora row and S3 redacted-path contents contain no raw PII/secret — redaction provably runs before persist (ordering covered by a test).
- Every evidence_items row carries release_run_id, source, source_url, and raw_excerpt_s3_uri.
- Raw evidence is never inlined in Aurora and never reaches the client except via presigned URL.
- Boundary inputs are Pydantic-validated; malformed diff payloads fail closed with a user-safe error.
- Redaction module has explicit tests with ≥80% coverage on new/changed code.
