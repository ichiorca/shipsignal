---
name: harness-specify
description: Decompose the PRD into an ordered specs/NNN-*/ set (the code-generation runway).
disable-model-invocation: true
---

# Decompose the PRD into specs

Run `harness spec-kit specify --prd specs/PRD.md` with your shell tool to decompose the PRD into an ordered set of thin, end-to-end specs (spec.md/plan.md/tasks.md), grounded in the PRD + constitution. Then review `specs/*/spec.md` WITH the operator before building — the spec set is the contract the autonomous build implements. Pass `--force` only to regenerate an existing layout.

---
**Stream progress natively:** run the command in the FOREGROUND with your shell tool so its output streams live into the operator's session — relay it as it appears, not just a summary at the end. **Do NOT detach it to the background** — that hides the live stream. For a genuinely long-running command, set your shell tool's maximum timeout; if it is cut off, resume rather than backgrounding. The operator wants to watch it happen, not poll a detached job.