---
name: harness-build
description: Autonomously implement the spec chain — build, test, review, commit, tag, advance.
disable-model-invocation: true
---

# Build the app from specs (autonomous chain)

Run `harness spec-kit implement --continuous --run-tests` with your shell tool. With no `--spec` it auto-starts at the lowest-numbered `specs/NNN-*` and walks the chain; pass `--spec=<id>` only to start mid-chain. Per spec it builds, runs `metadata.testCommand`, runs review + completeness, auto-commits, tags `spec-NNN-complete`, and advances — stopping when specs run out or a gate fails.

Run it in the FOREGROUND so its output streams live into the operator's session (set your shell tool's MAXIMUM timeout). It streams `--output-format stream-json` + per-spec phase lines, so the operator watches each task/spec as it happens. **Do NOT detach it to the background** — that hides the live stream, which defeats the point. If your shell tool caps long foreground runs and the chain is long, run it one spec at a time in the FOREGROUND (`harness spec-kit implement --spec=<NNN> --run-tests`, advancing to the next after each passes) and/or resume a cut-off run with `--mode resume`. Prefer chunked foreground over backgrounding.

CONFIRM with the operator first that (a) the spec set exists and has been reviewed (`/harness-specify`), and (b) the cost cap is acceptable. After a stop, fix the issue and resume with `--mode resume`. For a single spec interactively (you do the work, Stop hook gates), use `/spec-kit-implement <id>` instead.

---
**Stream progress natively:** run the command in the FOREGROUND with your shell tool so its output streams live into the operator's session — relay it as it appears, not just a summary at the end. **Do NOT detach it to the background** — that hides the live stream. For a genuinely long-running command, set your shell tool's maximum timeout; if it is cut off, resume rather than backgrounding. The operator wants to watch it happen, not poll a detached job.