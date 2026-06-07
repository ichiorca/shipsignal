# Feature clustering + scoring + Gate #1 approval

> PRD anchors: 4. Core Product Flow; 5.2 Release intelligence graph; 5.6 Human approval gates (Gate #1); 7. Feature Manifest; 10.2 Feature tables; 10.4 Approval tables; 1.1 Core goals (#4,#5)

## Summary

Cluster evidence into candidate features via Bedrock Converse, score marketability/demoability/confidence, persist the feature manifest with evidence links, and enforce the first mandatory human gate: a reviewer approves/edits/rejects the manifest before anything downstream runs.

## Acceptance criteria

- The graph blocks at Gate #1 and does not generate any content until a human decision is recorded (no self-approval path exists).
- Approve/edit/reject each writes an approvals row with reviewer + decision; edits store edited_payload_json; resume continues the same thread_id.
- Bedrock Converse is the only model path and a Guardrail is attached; prompts contain only redacted evidence.
- Each persisted feature links to ≥1 evidence_item via feature_evidence_links.
- Playwright e2e covers the Gate #1 approve and reject flows; review UI is WCAG 2.2 AA.
