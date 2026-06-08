# Tasks — Audit-trail hashing and deterministic redaction hardening

- [x] **T1 — Artifact content hash** Compute and persist a content hash for every artifact (migration adds the column; hash on write/update).
- [x] **T2 — Immutable approved-content snapshot** At approval time, snapshot the approved content into a tamper-evident record distinct from the mutable artifact row; record all §18.3 audit fields.
- [x] **T3 — Named deterministic checks** Implement code checks for codenames, customer names, private URLs, internal hostnames, and security-implementation details; run them in pre-review artifact validation; project-configurable lists.
- [x] **T4 — Skill-candidate pre-promotion scan** Run a proposed skill body through deterministic + Guardrails content scanning (§18.2 layer 3) before repo replacement; block promotion on failure.
- [x] **T5 — Fail-closed tests** Tests proving each new check blocks on violation and that the artifact hash / approved snapshot are produced and stable.
