# Tasks — Skills inventory reconciliation and PR-based promotion mode

- [ ] **T1 — Add missing canonical skills** Create `product-context`, `audience-map`, and `redaction-rules` SKILL.md with §9.1 frontmatter; `redaction-rules` encodes the §18.1 redaction policy.
- [ ] **T2 — Stamp promotion provenance** Write `last_promoted_candidate_id` into skill frontmatter on promotion.
- [ ] **T3 — PR-based promotion mode** Implement approve → branch → replace SKILL.md → open PR → record commit/PR SHA in Aurora; keep direct-write as a selectable fallback.
- [ ] **T4 — Mode selection + tests** Config-selectable promotion mode; tests covering PR mode, frontmatter stamping, and preservation of all §9.4 safety invariants.
