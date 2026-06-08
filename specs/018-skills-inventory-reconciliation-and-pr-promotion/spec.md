# Skills inventory reconciliation and PR-based promotion mode

> PRD anchors: 9.1 canonical skill set + frontmatter (last_promoted_candidate_id); 9.4.4 / 15.3 skill promotion modes (preferred PR mode)

## Summary

The canonical skill inventory diverges from PRD §9.1 — `product-context`, `audience-map`, and `redaction-rules` SKILL.md files are missing (redaction is a §18.1 governance concern, so its absence as a skill is notable). The `last_promoted_candidate_id` frontmatter is never stamped on promotion. And only the §15.3 hackathon-fast direct-write promotion mode exists; the preferred branch/PR mode (§9.4.4 sentence 4 / §15.3) is not built. Reconcile the inventory and add the production promotion mode without weakening any §9.4 safety invariant.

## Acceptance criteria

- Canonical `skills/<name>/SKILL.md` files exist for `product-context`, `audience-map`, and `redaction-rules`, each with the §9.1 frontmatter (name, version, owner, status, evolvable); `redaction-rules` reflects the §18.1 redaction policy.
- `last_promoted_candidate_id` frontmatter is written when a skill candidate is promoted.
- A PR-based promotion mode (§15.3 preferred) is implemented: approve → create branch → replace `skills/<skill>/SKILL.md` → open PR → record the resulting commit/PR SHA in Aurora; the direct-write mode remains available as a selectable fallback.
- All §9.4 safety invariants are preserved (no silent overwrite, explicit human approval, same-path replacement, old+new hash preservation, rejected-candidate retention, cooldown suppression).
- Promotion mode is selectable via configuration; tests cover PR mode and frontmatter stamping.
