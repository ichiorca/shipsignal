---
name: spec-kit-handoff
description: Prime the L1 event log + linkedSpec for a spec. Emit one task event per declared T-ID.
argument-hint: <spec-id>
disable-model-invocation: true
---

# Prime spec-kit handoff for $1

Rewrites `metadata.linkedSpec`, emits one `agent.workflow.spec-kit.task` event
per declared task ID, and tags the spec by git-cleanliness. Used as a pre-flight
before non-autonomous implementation passes.

## Run it

```
harness spec-kit handoff --spec=$1
```

Report the spec's provenance class (`repo-versioned` vs `repo-unversioned`) and
the task count emitted. If `repo-unversioned`, prompt the operator to commit
the spec.md so downstream provenance carriers land cleanly.
