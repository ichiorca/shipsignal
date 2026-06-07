# Full-loop end-to-end wiring, resume, and DoD hardening

> PRD anchors: 4. Core Product Flow; 5.1 Graphs; 5.6 Human approval gates; 8. Definition of done (constitution); 6. Quality bars

## Summary

Wire all four graphs into the complete reproducible loop on the Actions runner, ensure each gate resumes the same thread_id, add Playwright e2e across every approval-gate and artifact-review flow, document env/secrets, and verify the v1.0 Definition of Done.

## Acceptance criteria

- A single release run completes the entire loop with all three human gates honored and the same thread_id resumed at each.
- Every shipped artifact has claim-level provenance traceable to evidence; nothing publishes without its gate.
- Playwright e2e passes for all approval-gate and artifact-review flows; tsc/mypy/ruff/eslint and migration check clean.
- The loop reproduces on a clean GitHub Actions runner from documented env/secrets with no secrets in code/logs/DB/client.
- No deferred non-goal (autopublish, AI video, multi-VCS, Step Functions/EventBridge/Lambda, KBs/Agents) was introduced.
