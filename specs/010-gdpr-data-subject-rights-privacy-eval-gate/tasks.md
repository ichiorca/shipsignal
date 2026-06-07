# Tasks — GDPR data-subject rights + privacy eval gate

- [ ] **T1 — Retention/TTL + lawful-basis metadata** Add retention/TTL and recorded lawful-basis/purpose fields to PII-bearing evidence; enforce TTL cleanup.
- [ ] **T2 — Erasure operation across Aurora + S3** Implement a release-run/data-subject erasure that deletes/anonymizes matching Aurora rows and S3 objects (evidence, screenshots, media), scoped and audited; verify no orphaned S3 keys remain.
- [ ] **T3 — Access/export endpoint** Provide a server-side data-subject access export of personal data held, with escalation/approval before fulfillment.
- [ ] **T4 — PII-free telemetry/logging audit + fix** Scrub PII from logs/telemetry; lazy %-style logging; add a check that fails CI if PII patterns appear in logged fields.
- [ ] **T5 — Wire privacy eval suite as blocking gate** Add PII/PHI exposure, claim provenance/accuracy, and redaction-integrity eval categories; run via harness eval; CRITICAL/HIGH must be zero failures to deploy.
