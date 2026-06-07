# evals/

Project evals verify your harness primitives (skills, hooks, tools, the
safety floor) and gate changes. They are run by the harness itself, not by
the coding adapter:

    harness eval bootstrap --prd <spec>  # generate project evals from the PRD
    harness eval list                    # show registered evals
    harness eval run --eval <name>       # run one

## Anatomy of an eval

Each `evals/*.cue` file merges a `harness: evals: "<name>": {…}` block
into the manifest. Key fields:

- `kind`: capability | regression | property | counterfactual
- `target`: the primitive it verifies (`{kind, ref}`)
- `graders`: code (a script that exits 0/non-zero), model, or human
- `passCriteria`: e.g. `{kind: "pass-at-k", k: 1, minPass: 1.0}`
- `triggers`: pre-commit | on-promote | nightly | on-demand
- `failure`: block-change | warn | open-issue | record-only

## Where evals come from

Run `harness eval bootstrap --prd <spec>` to generate PROJECT-SPECIFIC evals
(an acceptance gate from the definition-of-done + one compliance gate per
regulated domain). They land here as `<name>.cue` + a grader SKELETON under
`graders/`, wired NOT to gate (record-only, on-demand) because at PRD time
there's no code to check yet. After the code exists, fill the grader, then set
`failure: "block-change"` + add a `pre-commit` trigger to enforce it. You can
also derive evals from real runs with `harness eval seed-from-trace`.

## Hooks vs evals

Hooks (`hooks/*.cue`) react to lifecycle events (PreCommit, SessionStart,
PreToolUse…) and can block in-line. Evals are batch verifications of
behaviour. A hook can run an eval via an `action: {kind: "eval"}` block —
that is how an eval becomes a gate.
