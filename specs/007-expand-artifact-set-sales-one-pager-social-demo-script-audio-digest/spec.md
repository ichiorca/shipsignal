# Expand artifact set: sales one-pager, social, demo script, audio digest

> PRD anchors: 8.1 Initial artifact types; 8.2 Deferred artifact types; 5.3 Content generation graph; 1.1 Core goals (#6)

## Summary

Broaden content_generation_graph to generate the remaining initial artifact types in parallel — sales one-pager, LinkedIn/social snippet, demo script, and release audio-digest script — each flowing through the same claims → checks → Guardrails → Gate #2 path established previously.

## Acceptance criteria

- All five remaining artifact types generate from approved features and appear for review; deferred types are not produced.
- Each artifact type is decomposed into evidence-linked claims and passes Guardrails before Gate #2.
- Parallel generation stays within the token/latency budget gate (no untracked model-tier upgrade).
- Multi-artifact review UI is WCAG 2.2 AA and Playwright-covered.
- Coverage ≥80% on new generator modules.
