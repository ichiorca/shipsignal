package main

// Default PreCommit gate (seeded by `harness adapter add`).
//
// On hook-capable adapters (claude-code, gemini-cli, codex-cli) the harness
// synthesises a PreCommit event from a `git commit` Bash call, so this
// fires automatically before every agent commit and BLOCKS it on a non-zero
// exit (blocking: true).
//
// Keep this gate FAST. The synthesised PreCommit runs inside the PreToolUse
// budget (~5s on claude-code), so put only quick checks here (lint, format,
// a blank-stub guard). Full test suites belong in the spec-kit Stop gate,
// which has a 10-minute budget and runs metadata.testCommand. Edit
// scripts/harness-precommit.sh to add project-specific checks.
harness: hooks: "precommit-gate": {
	name:      "precommit-gate"
	lifecycle: "ga"
	owner:     "me"
	spec: {
		event:    "PreCommit"
		layer:    "L0"
		blocking: true
		action: {
			kind:           "script"
			bodyRef:        "scripts/harness-precommit.sh"
			timeoutSeconds: 120
		}
	}
}
