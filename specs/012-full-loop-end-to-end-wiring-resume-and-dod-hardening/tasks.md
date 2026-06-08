# Tasks — Full-loop end-to-end wiring, resume, and DoD hardening

- [x] **T1 — End-to-end graph handoffs** Chain release_intelligence → content_generation → media_generation → skill_learning, passing release_run_id/thread_id and resuming the same thread across all three gates.
- [x] **T2 — Resume robustness + retries** Verify checkpointer resume after each interrupt, idempotent re-entry, and retry semantics for transient Bedrock/GitHub/S3 failures.
- [x] **T3 — Full Playwright e2e suite** Cover release review, Gate #1 feature approval, Gate #2 artifact review (incl. blocked claim), and Gate #3 skill approval, end-to-end on synthetic data.
- [x] **T4 — Env/secrets + reproducibility docs** Document all required GitHub/Vercel/AWS env secrets and the Actions workflow so a run reproduces on a clean runner; no hardcoded secrets.
- [x] **T5 — DoD verification pass** Run the full loop on a real release: trigger → evidence/redact/persist → signals → features → Gate#1 → artifacts → claims/checks → Gate#2 → media → learning → Gate#3 → SKILL.md replaced + SHA recorded. Confirm all §6 bars green.
