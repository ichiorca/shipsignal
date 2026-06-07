---
name: harness-events
description: Summarize recent L1 event-log activity for this session (tool calls, auth decisions, hook fires, costs).
disable-model-invocation: true
---

# Inspect the harness L1 event log

Run `harness events query --since=<ISO8601 a few minutes ago>` with your shell tool for a bounded snapshot of recent activity (add `--kind`/`--session` to filter). Do NOT use `harness events tail` here — it blocks forever; only use tail for a deliberate live follow.

Summarize the recent activity for the operator: notable tool calls, authorization decisions, hook fires, cache/idempotency/backpressure events, and cost ticks. Flag anything denied or short-circuited.

---
**Stream progress natively:** run the command in the FOREGROUND with your shell tool so its output streams live into the operator's session — relay it as it appears, not just a summary at the end. **Do NOT detach it to the background** — that hides the live stream. For a genuinely long-running command, set your shell tool's maximum timeout; if it is cut off, resume rather than backgrounding. The operator wants to watch it happen, not poll a detached job.