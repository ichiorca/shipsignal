package schema

// #Agent — root type. A model-driven actor with its own scope of authorizations,
// system prompt, sub-agent delegation pool, and model selection.
#Agent: {
	// Required structural metadata; NEVER agentVisible.
	name:         string
	lifecycle:    "alpha" | "beta" | *"ga" | "deprecated"
	owner:        string
	agentVisible: false // structural; compile-time deny

	// Model selection.
	model: {
		default: string // e.g., "claude-sonnet-4-6"
		fallback?: [...string]
		// perAdapter overrides `default` when the active adapter
		// matches the key — letting one agent run across all three
		// adapters without rewriting the manifest. Example:
		//   model: {
		//     default: "claude-sonnet-4-7"
		//     perAdapter: {
		//       "gemini-cli": "gemini-2.5-pro"
		//       "codex-cli":  "gpt-5-codex"
		//     }
		//   }
		// (Gap FF)
		perAdapter?: [string]: string
	}

	// Authorization scope — names of #Authorization records the agent inherits.
	authorizations: [...string]

	// Skills the agent may load.
	skillPool: [...string]

	// Sub-agents this agent may dispatch via #DispatchAgentAction.
	delegationPool?: [...string]

	// System prompt — points to a markdown file. Loaded at session start.
	systemPromptRef: string

	// description — one-line summary of when this agent should be
	// delegated to. Required by Claude Code subagents for automatic
	// delegation; emitted into the vendor-native subagent frontmatter.
	// Optional so hand-authored agents stay valid. (Gap AGENT-BOOTSTRAP)
	description?: string

	// allowedTools — optional tool allowlist materialised into the
	// vendor-native subagent's `tools` field (Claude Code) / extension
	// `tools` (gemini). Empty = inherit the vendor default tool set.
	allowedTools?: [...string]

	// scope — where the materialised subagent file is written:
	//   "user"    — vendor user-config dir (~/.claude/agents, legacy default)
	//   "project" — <projectRoot>/.claude/agents (project-specific agents,
	//               e.g. bootstrap-generated reviewers)
	// Empty = legacy user-scope (no regression for existing agents).
	scope?: "user" | "project"

	// Trigger patterns for the dispatch router (used when this agent is a
	// candidate for delegation).
	triggerPatterns?: #TriggerPatterns

	// Whether the agent runs in the autonomous-mode cost-cap regime.
	autonomousMode: *false | true

	// lifecycleOnce — when true, the runtime deauthorises this agent
	// after its first complete invocation (signalled by an explicit
	// `<agentName>.complete` sensor event). Used by the long-running-
	// agent recipe's initializer per TECH-SPEC §7B.5: scaffolding work
	// runs once at project bootstrap, then the broad authorization
	// surface is mechanically retracted. Re-running requires a manual
	// clear of the lifecycle marker.
	lifecycleOnce: *false | true

	// invokedBy — sensor event kinds that may trigger this agent. Used
	// by the advisor pattern (TECH-SPEC §7B.8): the advisor declares
	// `invokedBy: ["agent.bearings.drift-suspected"]` and is candidate
	// for invocation only when the named sensor fires. Sensor events
	// are surfaced via L1 event-log visibility; the harness does NOT
	// directly orchestrate the invocation (anti-orchestration-overreach
	// per SPEC §1.0.7).
	invokedBy?: [...string]
}

// #TriggerPatterns — v1.0.8 sub-type. Used by the dispatch router skill to
// score this agent against a task description. See SPEC.md §7.1.6 scoring
// algorithm steps 1-2.
#TriggerPatterns: {
	keywords?: [...string]
	// antiKeywords subtract from the keyword pass — words whose presence in
	// the task indicates this agent is NOT a fit (SPEC §7.1.6 step 1).
	antiKeywords?: [...string]
	// taskTypes that earn a +0.3 baseline when the parent scope's task type
	// matches (SPEC §7.1.6 step 2).
	taskTypes?: [...string]
	pathGlobs?: [...string]
	semanticHints?: [...string]
	// Confidence floor below which the router refuses to recommend this agent.
	confidenceFloor: *0.6 | float & >=0 & <=1
}
