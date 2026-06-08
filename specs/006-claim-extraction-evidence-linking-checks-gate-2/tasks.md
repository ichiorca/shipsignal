# Tasks — Claim extraction, evidence linking, checks + Gate #2

- [x] **T1 — Migrations for artifact_claims + claim_evidence_links** Create §10.3 artifact_claims and claim_evidence_links tables.
- [x] **T2 — extract_claims node** Decompose each artifact into typed claims (capability/performance/etc.) with support_status + risk_level; Pydantic-validated.
- [x] **T3 — link_claims_to_evidence node** Use pgvector + deterministic matching to link claims to evidence_items with support_score; claims with no link are marked unsupported and cannot be approved.
- [x] **T4 — run_deterministic_policy_checks + run_bedrock_guardrails nodes** Blocking checks for unsupported claims and PII/sensitive info; failures flag/block the artifact and escalate (no silent bypass).
- [x] **T5 — Gate #2 interrupt + artifact review UI** approve_artifacts interrupt; dashboard shows artifact + per-claim support/risk + evidence links; approve/edit/reject writes approvals + artifact_claims review and resumes thread.
