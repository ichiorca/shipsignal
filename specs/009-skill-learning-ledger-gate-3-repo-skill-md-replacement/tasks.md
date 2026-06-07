# Tasks — Skill learning ledger + Gate #3 repo SKILL.md replacement

- [ ] **T1 — Migrations for learning_signals + skill_revision_candidates + suppressions** Create §10.5 learning_signals, skill_revision_candidates, and skill_candidate_suppressions tables.
- [ ] **T2 — collect_learning_signals node** Capture reviewer edit diffs, rejected claims, and notes from Gate #1/#2 approvals into learning_signals with related skill snapshot ids.
- [ ] **T3 — cluster_edit/rejection_patterns + select_impacted_skills** Cluster signals, map them to impacted skills, and select candidates for revision.
- [ ] **T4 — draft_skill_revision_candidate + persist_candidate_in_aurora** Generate proposed_body/frontmatter + proposal_reason + supporting_signal_ids; persist as status=draft. Never touch the repo file here.
- [ ] **T5 — Gate #3 interrupt + proposed-skill UI** approve_skill_candidate interrupt; dashboard shows current vs proposed SKILL.md diff, supporting signals, confidence, risk, with Approve/Reject/Request-changes.
- [ ] **T6 — update_repo_skill_file + mark_candidate_promoted / suppression path** On approve, replace the SKILL.md at the same path on a controlled branch (or PR), record promoted_commit_sha + old/new content_hash + reviewer/timestamp. On reject, record rejection + add a cooldown suppression for near-duplicates.
