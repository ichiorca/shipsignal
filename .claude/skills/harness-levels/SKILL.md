---
name: harness-levels
description: Show the project's harness depth (L0–L4) and which standard primitives are on.
disable-model-invocation: true
---

# Show harness depth

Run `harness levels status` with your shell tool and report the current depth ladder (L0–L4) and which standard_l* flags are enabled. If the operator asks to change depth, use `harness levels set <L2|L3|L4>` (cumulative) — but confirm first, since it recompiles.

---
**Stream progress natively:** run the command in the FOREGROUND with your shell tool so its output streams live into the operator's session — relay it as it appears, not just a summary at the end. **Do NOT detach it to the background** — that hides the live stream. For a genuinely long-running command, set your shell tool's maximum timeout; if it is cut off, resume rather than backgrounding. The operator wants to watch it happen, not poll a detached job.