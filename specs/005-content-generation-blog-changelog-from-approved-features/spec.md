# Content generation: blog/changelog from approved features

> PRD anchors: 5.3 Content generation graph; 8.1 Initial artifact types; 9.1 Canonical skill source; 9.2 Aurora role in skills; 9.3 Skill lifecycle (steps 2–3); 10.3 Artifact tables; 10.5 Skill provenance tables; 1.1 Core goals (#6)

## Summary

First content_generation_graph slice: load approved features, snapshot active repo skills into Aurora (with usage events), and generate the release blog + changelog via Bedrock Converse. Persist reviewable artifacts in draft. No claims/checks/gate yet — that is the next slice.

## Acceptance criteria

- Artifacts are generated only from approved features; with zero approved features the graph does not produce artifacts.
- Each generated artifact records which skill snapshot versions/hashes were loaded (skill_usage_events) and the canonical source remains the repo SKILL.md.
- Generation uses Bedrock Converse with validated, Pydantic-checked output.
- Artifacts persist with release_run_id, model_id, prompt_version, and status=draft.
- Draft preview page is WCAG 2.2 AA; coverage ≥80% on new modules.
