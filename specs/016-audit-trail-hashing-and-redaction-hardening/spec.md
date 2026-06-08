# Audit-trail hashing and deterministic redaction hardening

> PRD anchors: 18.3 Audit trail (artifact hash, final approved content); 12.3 / 18.1 deterministic checks (codenames, customer names, private URLs, internal hostnames, security details); 12.2 / 18.2 layer-3 skill-candidate validation

## Summary

The governance layer has three concrete holes. The audit trail (§18.3) requires a per-artifact hash and a final approved-content record, but the artifact body is a mutable row with no hash. Several §12.3/§18.1 deterministic checks (codenames, customer names, private URLs, internal hostnames, security-implementation details) exist only as a prompt instruction, not as code. And §18.2 layer-3 / §12.2 item 3 — scanning a proposed skill body before it can replace a repo file — is not enforced. Harden all three; everything must fail closed.

## Acceptance criteria

- Every artifact stores a content hash; at approval time the approved content is immutably snapshotted (a tamper-evident record distinct from the mutable working row) and the audit trail records all §18.3 fields.
- Deterministic checks for codenames, customer names, private URLs, internal hostnames, and security-implementation details are implemented as code and run during pre-review artifact validation (§18.2 layer 2), independent of Bedrock Guardrails.
- A proposed skill-candidate body passes a pre-promotion deterministic + Guardrails content scan (§18.2 layer 3) before any repo replacement; a failing scan blocks promotion.
- All new checks fail closed; existing claim/redaction gates and the §9.4 skill safety invariants are unchanged.
- Lists of codenames/customer names/internal hostnames are configurable (project-supplied), not hardcoded to one tenant.
