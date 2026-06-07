---
name: harness-learn
description: Mine the L1 event log into instinct-style memory the agent carries next session.
disable-model-invocation: true
---

# Mine harness instincts

Run `harness learn` with your shell tool to distill the L1 event log into instinct-style memory entries. Report what was learned. High-confidence instincts surface in AGENTS.md next session, so review them for correctness before relying on them.

---
**Stream progress natively:** run the command in the FOREGROUND with your shell tool so its output streams live into the operator's session — relay it as it appears, not just a summary at the end. **Do NOT detach it to the background** — that hides the live stream. For a genuinely long-running command, set your shell tool's maximum timeout; if it is cut off, resume rather than backgrounding. The operator wants to watch it happen, not poll a detached job.