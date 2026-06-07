package schema

import "github.com/agent-harness/harness/schema/shared"

// #Workflow — root type (§4.2). A Claude Code *dynamic workflow*: a
// JavaScript orchestration script that fans work across many subagents,
// surfaced as a `/<name>` slash command (research preview, Claude Code
// v2.1.154+; https://code.claude.com/docs/en/workflows).
//
// The harness VERSIONS an existing script by pointer (`bodyRef`) — it does
// NOT generate the JS, because the runtime's subagent-spawn API is not
// publicly documented. Authors write a workflow via the `ultracode` keyword
// and save it with `/workflows` → s, then point a #Workflow at the saved
// file. Parity with #Skill: the body lives in a file referenced by `bodyRef`.
//
// Gated by featureFlags.standard_l4_dynamic_workflows; governed (binary
// on/off) by #WorkflowPolicy. The harness "works identically without it":
// absent the flag, no workflow is compiled.
#Workflow: {
	name:      string
	lifecycle: "alpha" | "beta" | *"ga" | "deprecated" | "shadow"
	owner:     string
	version?:  shared.#SemVer

	// Structural infrastructure (compiles to a /<name>.js slash command),
	// NEVER surfaced to the model as catalog content — §4.1.2 compile-time
	// deny. Parity with #Hook / #Sandbox / #AdapterContract.
	agentVisible: false

	// One-line description; doubles as the slash-command description.
	description: string

	// Path to the .js orchestration script, resolved relative to the
	// harness root (mirror #Skill.bodyRef).
	bodyRef: string

	// scope routes the compiled output dir: "user" → $CLAUDE_HOME/workflows,
	// "project" → <projectRoot>/.claude/workflows. Mirror #Skill.scope.
	scope?: "user" | "project"

	// Optional default `args` payload — the workflow's documented input
	// contract (the runtime exposes `args` as a global). Open; not validated.
	args?: {...}
}

// #WorkflowPolicy — governance lever for dynamic workflows. When
// enabled=false the compiled settings.json gets "disableWorkflows": true
// (the documented operator/org off switch). The `ultracode` keyword has no
// settings.json key (it is a /config toggle only); the env equivalent is
// CLAUDE_CODE_DISABLE_WORKFLOWS=1. Default true = no change to behaviour.
#WorkflowPolicy: {
	enabled: *true | false
}
