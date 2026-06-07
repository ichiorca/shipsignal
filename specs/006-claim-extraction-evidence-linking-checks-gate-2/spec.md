# Claim extraction, evidence linking, checks + Gate #2

> PRD anchors: 5.3 Content generation graph; 8.3 Claim-level contract; 10.3 Artifact and claim tables; 5.6 Human approval gates (Gate #2); 1.1 Core goals (#7)

## Summary

Make artifacts trustworthy and approvable: decompose each artifact into claims, link every claim to concrete evidence, run deterministic policy checks plus Bedrock Guardrails (unsupported-claim + PII blocking), then the second mandatory human gate for artifact approval. Unlinkable/unsupported/high-risk claims are blocked before Gate #2.

## Acceptance criteria

- An unsupported/high-risk claim (e.g. a fabricated ROI figure with no evidence) is blocked or flagged and cannot reach an approved state.
- Every approved claim has ≥1 claim_evidence_links row; unlinkable claims are never persisted as approved.
- Guardrails + deterministic checks run on every artifact before Gate #2 and a failure halts/escalates rather than auto-passing.
- Gate #2 requires a human decision; approve/edit/reject is recorded with reviewer.
- Playwright e2e covers the Gate #2 flow including a blocked-claim case; UI is WCAG 2.2 AA.
