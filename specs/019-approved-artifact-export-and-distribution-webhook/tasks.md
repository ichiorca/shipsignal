# Tasks — Approved-artifact export and outbound distribution webhook

- [x] **T1 — Export API** `GET /api/artifacts/{artifactId}/export` and `GET /api/releases/{releaseRunId}/artifacts/export`, reading exclusively from `approved_artifact_snapshots`; 409 on non-approved; markdown/html/json formats with provenance in JSON.
- [x] **T2 — Dashboard export UI** Copy/Download actions on approved artifacts (review page + claim inspector); a11y per WCAG 2.2 AA; e2e coverage.
- [x] **T3 — Outbound webhook dispatcher** Server-side dispatcher triggered by the approve routes; `outbound_webhook_deliveries` migration + db module; payload assembly from approved snapshot only.
- [x] **T4 — Signing, idempotency, retry** HMAC-SHA256 over raw body, stable delivery ids, exponential backoff with cap, delivery audit rows; secrets from env, never logged.
- [x] **T5 — Tests + docs** Unit tests for all gates above, e2e for export, docs page covering consumer-side signature verification and the egress-allowlist/secret prerequisites.
