# Tasks — Expand artifact set: sales one-pager, social, demo script, audio digest

- [ ] **T1 — generate_artifacts_parallel fan-out** Add sales_onepager, linkedin_post, demo_script, release_audio_digest generators running in parallel within the graph, each using the relevant format skill snapshot.
- [ ] **T2 — Per-type prompt + format skills wiring** Map each artifact type to its SKILL.md (sales-onepager-format, demo-script-format, blog-format, brand-voice); record skill_usage_events per node.
- [ ] **T3 — Route all new types through claims + checks + Gate #2** Ensure extract_claims/linking/policy/Guardrails apply uniformly; demo_script claims still require evidence linkage.
- [ ] **T4 — Dashboard multi-artifact review** Artifact-review screen tabs/sections per artifact type with per-claim provenance; keyboard-operable.
