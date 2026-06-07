---
name: harness-cost
description: Report harness-tracked spend over a recent window.
disable-model-invocation: true
---

# Report harness cost

Run `harness cost --window-days 1` (adjust the window if the operator asks) with your shell tool and report the spend, broken down by model/session as available. Note if it approaches the configured cost cap.

---
**Stream progress natively:** run the command in the FOREGROUND with your shell tool so its output streams live into the operator's session — relay it as it appears, not just a summary at the end. **Do NOT detach it to the background** — that hides the live stream. For a genuinely long-running command, set your shell tool's maximum timeout; if it is cut off, resume rather than backgrounding. The operator wants to watch it happen, not poll a detached job.