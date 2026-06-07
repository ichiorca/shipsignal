# specs/

This directory holds spec-kit specs — numbered feature directories that drive
the implementation flow via `harness spec-kit brief / handoff / implement`.

## Convention

```
specs/
└── 001-<feature-slug>/
    ├── spec.md     — WHAT: goals, acceptance criteria, non-goals
    ├── plan.md     — HOW: technical approach, design decisions
    └── tasks.md    — numbered checklist (T1, T2, …) the agent cites in commits
```

Spec IDs are zero-padded (`001`, `002`, …). The slug is lowercase, hyphen-separated,
and stable — it appears in commit messages and L1 events for the life of the spec.

## Workflow

```bash
harness spec-kit doctor                          # pre-flight
harness spec-kit brief --spec=001-feature        # render the implementation brief
harness spec-kit handoff --spec=001-feature      # prime the L0/L1/L2 surface
harness spec-kit implement --spec=001-feature    # composite: handoff → brief → agent → review
harness spec-kit review --since=24h              # cross-cutting audit
harness spec-kit progress                        # project-level rollup
```

## Authoring tips

- Every task in `tasks.md` should have a stable ID (T<N>); commits derived from a task
  cite that ID in the message so `harness spec-kit progress` can compute citation coverage.
- `spec.md` is the appropriate place for acceptance criteria, not `plan.md`. Reviewers
  diff-check the spec at PR time.
- Keep `plan.md` focused on resolving ambiguities ("why this design over that one")
  rather than restating the spec.
- `memory/constitution.md` is concatenated into every brief; rules that apply to ALL
  specs belong there, not duplicated per-spec.
