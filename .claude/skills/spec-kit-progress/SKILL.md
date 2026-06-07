---
name: spec-kit-progress
description: Report task coverage across every spec; show BUILD COMPLETE when all cited.
disable-model-invocation: true
---

# Run spec-kit progress

Project-level rollup of task coverage across every spec. Emits one
`agent.workflow.spec-kit.build-complete` event the first time every declared
task in every spec has a citation.

## Run it

```
harness spec-kit progress
```

Report the per-spec table (declared vs cited counts) and the overall BUILD
COMPLETE status. If any spec has `missing` tasks, list them and recommend
whether to implement, drop, or defer them.
