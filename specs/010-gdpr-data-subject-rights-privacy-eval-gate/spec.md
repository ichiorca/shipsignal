# GDPR data-subject rights + privacy eval gate

> PRD anchors: 5. Safety rails (GDPR); 6. Quality bars (Privacy/domain evals); 9.2 (provenance retention)

## Summary

Make personal-data handling compliant and verifiable: data-subject erasure across both Aurora and S3, access/export, retention/TTL on PII-bearing data, no PII in telemetry/logs, and an escalation trigger for any data-subject request. Wire the privacy eval suite as a blocking CRITICAL/HIGH gate.

## Acceptance criteria

- An erasure request removes the subject's personal data from both Aurora and S3 (verified: no rows, no objects, no presigned-reachable remnants).
- Access export returns only that subject's data and requires human escalation/approval before fulfillment.
- No PII appears in logs or telemetry (enforced by an automated check).
- Privacy eval suite runs in CI and blocks deploy on any CRITICAL/HIGH failure.
- Erasure verified on a real release run; redaction integrity test green.
