---
name: harness-bearings
description: Re-read project bearings — active feature/spec, constitution principles, protected paths, recent progress, cost.
disable-model-invocation: true
---

# Re-read harness bearings

Run `harness reground` with your shell tool and present its output to the operator: the active feature + spec, the constitution principles in force, the sandbox-protected paths you must not write, the most recent progress entries, and the current cost posture.

Use this at the start of a session, after a long detour, or whenever you're unsure what the project's invariants or active work are. Treat the protected paths and principles as binding for the rest of the session.

---
**Stream progress natively:** run the command in the FOREGROUND with your shell tool so its output streams live into the operator's session — relay it as it appears, not just a summary at the end. **Do NOT detach it to the background** — that hides the live stream. For a genuinely long-running command, set your shell tool's maximum timeout; if it is cut off, resume rather than backgrounding. The operator wants to watch it happen, not poll a detached job.