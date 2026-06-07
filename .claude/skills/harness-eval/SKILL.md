---
name: harness-eval
description: Run the project's evals and report pass/fail (CRITICAL/HIGH gates are deploy-blocking).
disable-model-invocation: true
---

# Run harness evals

Run `harness eval run <set>` with your shell tool (e.g. `project-acceptance`, `gdpr-compliance`). To (re)generate evals from the PRD first, run `harness eval bootstrap --prd specs/PRD.md`. Report pass/fail per case and surface any CRITICAL/HIGH failures — those block deploy. Never weaken a grader just to make it pass; fix the code or escalate.

---
**Stream progress natively:** run the command in the FOREGROUND with your shell tool so its output streams live into the operator's session — relay it as it appears, not just a summary at the end. **Do NOT detach it to the background** — that hides the live stream. For a genuinely long-running command, set your shell tool's maximum timeout; if it is cut off, resume rather than backgrounding. The operator wants to watch it happen, not poll a detached job.