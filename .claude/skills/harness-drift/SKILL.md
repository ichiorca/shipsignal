---
name: harness-drift
description: Establish a behavior baseline, or detect drift in L0 decisions / cost / eval pass-rate.
disable-model-invocation: true
---

# Harness drift gardener

Run `harness drift snapshot --as=baseline --adapter=claude-code` once (early) to capture a baseline. Later, run `harness drift snapshot --as=window --adapter=claude-code` then `harness drift report --baseline=baseline.json --window=window.json` to detect drift. Report any `harness.drift.detected` signals (L0 decisions, cost-per-call, eval pass-rate) for operator review.

---
**Stream progress natively:** run the command in the FOREGROUND with your shell tool so its output streams live into the operator's session — relay it as it appears, not just a summary at the end. **Do NOT detach it to the background** — that hides the live stream. For a genuinely long-running command, set your shell tool's maximum timeout; if it is cut off, resume rather than backgrounding. The operator wants to watch it happen, not poll a detached job.