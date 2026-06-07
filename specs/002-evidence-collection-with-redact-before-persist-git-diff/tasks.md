# Tasks — Evidence collection with redact-before-persist (git diff)

- [x] **T1 — Alembic migration for evidence_items** Create evidence_items per §10.1 including embedding vector(1536) column (nullable for now), risk_flags jsonb, metadata_json, FK to release_runs.
- [x] **T2 — load_release_boundary + collect_git_diff nodes** Resolve base/head refs and fetch changed files/hunks via GitHub API + git diff. Pydantic models for raw diff payloads; quota-aware paging.
- [x] **T3 — redact_evidence node** Deterministic redaction/normalize of personal data and secrets in excerpts per redaction-rules; produces redacted_excerpt + risk_flags. Runs strictly before any persist. Unit-tested with PII/secret fixtures.
- [x] **T4 — persist_evidence node (S3 raw + Aurora redacted)** Upload raw excerpt to s3://.../evidence/{release_run_id}/{evidence_id}.txt (sanitized keys, private bucket, presigned-only access), insert redacted evidence_items row with source_url + provenance metadata.
- [x] **T5 — Evidence dashboard view + presigned access** Run-detail page lists redacted evidence; raw bundles only via server-generated short-expiry presigned GET URLs. No PII/raw shipped to client.
