package main

// Default SessionStart context injection (seeded by `harness adapter add`).
//
// Non-blocking: whatever scripts/harness-context.sh prints to stdout is
// injected into the coding agent's session context, so project guardrails
// (AGENTS.md, memory/constitution.md) are always loaded at session start.
harness: hooks: "sessionstart-context": {
	name:      "sessionstart-context"
	lifecycle: "ga"
	owner:     "me"
	spec: {
		event:    "SessionStart"
		layer:    "L4"
		blocking: false
		action: {
			kind:           "script"
			bodyRef:        "scripts/harness-context.sh"
			timeoutSeconds: 10
		}
	}
}
