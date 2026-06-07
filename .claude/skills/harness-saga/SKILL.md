---
name: harness-saga
description: Report declared sagas and their persisted progression state.
disable-model-invocation: true
---

# Inspect harness sagas

Run `harness saga list` with your shell tool to show each declared saga and its state; for detail on one, run `harness saga status <name>`. Report progression (current step, completed steps, any compensations or rollbacks). Do not abort or compensate a saga unless the operator explicitly asks.

---
**Stream progress natively:** run the command in the FOREGROUND with your shell tool so its output streams live into the operator's session — relay it as it appears, not just a summary at the end. **Do NOT detach it to the background** — that hides the live stream. For a genuinely long-running command, set your shell tool's maximum timeout; if it is cut off, resume rather than backgrounding. The operator wants to watch it happen, not poll a detached job.