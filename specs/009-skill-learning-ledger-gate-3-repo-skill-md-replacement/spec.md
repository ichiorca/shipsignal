# Skill learning ledger + Gate #3 repo SKILL.md replacement

> PRD anchors: 5.5 Skill learning graph; 9.2 Aurora role in skills; 9.3 Skill lifecycle; 9.4 Skill replacement rules; 9.5 Proposed skill UI; 10.5 Skill provenance tables; 1.1 Core goals (#8,#9)

## Summary

skill_learning_graph mines reviewer edits/rejections into learning signals, clusters them, drafts a skill revision candidate in Aurora, and — only after the third mandatory human gate — replaces the canonical repo SKILL.md and records the commit SHA + old/new hashes. Rejected near-duplicates are suppressed for a cooldown.

## Acceptance criteria

- No repo SKILL.md is overwritten without an approved Gate #3 decision; the only repo write is the approved skill file.
- Promotion records commit SHA, old_content_hash, and new_content_hash in Aurora; hashes are preserved even after replacement.
- Rejected candidates persist with reason; near-duplicate candidates are suppressed during the cooldown window.
- Aurora remains a provenance ledger — the canonical skill is still the repo file (snapshot on next run reflects the new version).
- Playwright e2e covers Gate #3 approve and reject; proposed-skill diff UI is WCAG 2.2 AA.
