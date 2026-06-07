package schema

import "github.com/agent-harness/harness/schema/shared"

// #Hook — root type. A registered reaction to a runtime event.
#Hook: {
	// Required structural metadata; NEVER agentVisible.
	name:         string
	lifecycle:    "alpha" | "beta" | *"ga" | "deprecated"
	owner:        string
	agentVisible: false // structural; compile-time deny

	spec: #HookSpec
}

#HookSpec: {
	// Event the hook reacts to. Vendor-mapped at adapter level.
	event:
		"SessionStart" | "SessionEnd" |
		"PreToolUse" | "PostToolUse" |
		"UserPromptSubmit" |
		"PreAgentDispatch" | "PostAgentDispatch" |
		"PreCommit" | "PostCommit" |
		"OnSensorEvent"

	// Tool / event matcher (regex or literal).
	matcher?: string

	// Scope — "project" or "user" (precedence: project > user).
	scope: *"project" | "user"

	// Layer — informational classification (L0 / L1 / L2 / L3 / L4).
	layer: "L0" | "L1" | "L2" | "L3" | "L4"

	// Whether the hook blocks (deny on failure) or is advisory (sensor event on failure).
	blocking: *true | false

	// Action to run when the hook fires.
	action: #HookAction
}

// The 12 #HookAction kinds. Non-extensible per SPEC.md §4.1.1.
#HookAction:
	#ScriptAction |
	#EvalAction |
	#GrantAction |
	#RevokeAction |
	#AssertAction |
	#SequenceAction |
	#ParallelAction |
	#AlternationAction |
	#TimeoutAction |
	#NoopAction |
	#DispatchAgentAction |
	#RuntimeMediatedWriteAction

#ScriptAction: {
	kind:    "script"
	bodyRef: string // inline shell strings are an anti-pattern per SPEC.md §12.3
	timeoutSeconds?: int & >0
}

#EvalAction: {
	kind: "eval"
	eval: {
		name: string
	}
	async: *false | true
	onFailure: *"block" | "warn" | "open-issue" | "record-only"
}

#GrantAction: {
	kind:          "grant"
	authorization: string
	expiresIn?:    string // duration: "1h", "30m"
}

#RevokeAction: {
	kind:          "revoke"
	authorization: string
}

#AssertAction: {
	kind:      "assert"
	predicate: shared.#MatchPredicate
	onFailure: *"block" | "warn"
}

#SequenceAction: {
	kind: "sequence"
	actions: [...#HookAction]
	stopOnFirst?: "failure" | "success"
}

#ParallelAction: {
	kind: "parallel"
	actions: [...#HookAction]
}

#AlternationAction: {
	kind: "alternation"
	branches: [...#AlternationBranch]
	defaultBranch?: #HookAction
}

#AlternationBranch: {
	predicate: shared.#MatchPredicate
	action:    #HookAction
}

#TimeoutAction: {
	kind:           "timeout"
	timeoutSeconds: int & >0
	action:         #HookAction
}

#NoopAction: {
	kind: "noop"
	// Useful as the defaultBranch of alternations and as a marker for sensor-only registrations.
}

#DispatchAgentAction: {
	kind:  "dispatch-agent"
	agent: {
		name: string
	}
	// Narrowed in SPEC.md v1.0.7 — session-boundary routing ONLY.
	scope: *"session-boundary" | "session-boundary"
}

#RuntimeMediatedWriteAction: {
	kind:           "runtime-mediated-write"
	targetPathGlob: string
	// Validates the write request through a #Tool implementation, not direct fs.
	via: string // name of a #Tool with impl.kind = "builtin"
}
