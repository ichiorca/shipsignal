# Tasks — Content generation: blog/changelog from approved features

- [x] **T1 — Migrations for artifacts + skill_repo_snapshots + skill_usage_events** Create §10.3 artifacts and §10.5 skill_repo_snapshots/skill_usage_events tables.
- [x] **T2 — snapshot_active_skills node** Read skills/**/SKILL.md from the checked-out repo, parse frontmatter, compute content_hash, upsert skill_repo_snapshots (repo, skill_path, commit_sha unique), mark active.
- [x] **T3 — load_approved_features node** Load only Gate#1-approved features for the run; refuse to proceed if none approved.
- [x] **T4 — generate_artifacts (blog + changelog)** Bedrock Converse calls using snapshotted skills; record skill_usage_events (graph_name, node_name, skill_snapshot_id, usage_type). Validate model output via Pydantic.
- [x] **T5 — persist_reviewable_artifacts + draft view** Insert artifacts rows (status=draft, model_id, prompt_version, skill_versions_json); dashboard renders draft preview, keyboard-operable.
