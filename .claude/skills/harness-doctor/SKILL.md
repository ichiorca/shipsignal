---
name: harness-doctor
description: Run harness readiness checks and surface any warnings or failures.
disable-model-invocation: true
---

# Harness readiness check

Run `harness doctor` (and `harness spec-kit doctor` if this is a spec-kit project) with your shell tool. Report the readiness summary and surface every `[WARN]`/`[FAIL]` with what it means and how to fix it. Use this before starting a build or after changing configuration.

---
**Stream progress natively:** run the command in the FOREGROUND with your shell tool so its output streams live into the operator's session — relay it as it appears, not just a summary at the end. **Do NOT detach it to the background** — that hides the live stream. For a genuinely long-running command, set your shell tool's maximum timeout; if it is cut off, resume rather than backgrounding. The operator wants to watch it happen, not poll a detached job.