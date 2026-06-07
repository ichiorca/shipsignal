package schema

import "github.com/agent-harness/harness/schema/shared"

// #Skill — root type. A loaded prompt fragment surfaced to the model under the
// L2 discoverability budget (4000 tokens by default per SPEC.md §7.1).
#Skill: {
	// Required structural metadata; NEVER agentVisible.
	name:         string
	lifecycle:    "alpha" | "beta" | *"ga" | "deprecated" | "shadow"
	owner:        string
	evidence?:    string // pointer to evidence supporting promotion
	deprecation?: string // explanation; required when lifecycle = "deprecated"

	// version — optional semver tag. When set, #SpecPack.skillVersionPins
	// entries that reference this skill MUST match this version exactly
	// (lint enforces via checkSkillVersionPins). Skills without a version
	// cannot be pinned by any active spec-pack.
	version?: shared.#SemVer

	// agentVisible defaults true for skills (they exist to surface to the model).
	// Operators may flip false to load metadata-only.
	agentVisible: *true | false

	// scope selects where the compiled skill lands. "user" (default) keeps
	// the historical behaviour ($CLAUDE_HOME/skills, $GEMINI_HOME/extensions).
	// "project" routes to the project tree so the skill travels with the repo:
	//   claude  -> <projectRoot>/.claude/skills/<name>/SKILL.md
	//   gemini  -> <projectRoot>/.gemini/skills/<name>/SKILL.md (first-class Agent Skill)
	//   codex   -> <projectRoot>/.agents/skills/<name>/SKILL.md
	// `harness skills bootstrap` sets "project" on the skills it provisions.
	// Mirrors #Agent.scope.
	scope?: "user" | "project"

	// One-line agent-facing description.
	description: string

	// loadingMode — preloaded (always in catalog context) vs on-demand
	// (body fetched when the skill is first invoked). SPEC.md §6.3.1 v1.0.2.
	loadingMode: *"on-demand" | "preloaded"

	// Trigger patterns for the dispatch router (#DispatchRouterSkill in §7.1.6
	// of SPEC). Empty = always considered.
	triggerPatterns?: [...string]

	// Path to the markdown / prompt file. Resolved relative to harness root.
	bodyRef: string

	// Skill taxonomy (SPEC.md §6.3.1 v1.0.2).
	taxonomy: "task" | "reviewer" | "dispatch" | "advisor" | "initializer" | "fixture-generator"

	// reviewerType — set only when taxonomy = "reviewer". One of the three
	// canonical reviewer profiles (SPEC.md §7.2). Reviewer composition merges
	// outputs from one of each.
	reviewerType?: "code" | "security" | "architecture"

	// Eval entries that gate promotion from shadow → ga.
	gatingEvals?: [...string]

	// allowedTools restricts which tool families this skill may invoke.
	// Compiled into the Gemini CLI extension manifest's `tools` field
	// per TECH-SPEC §9.6. Empty = unrestricted.
	allowedTools?: [...string]

	// slashCommand, when set, declares the skill is invocable as a
	// vendor-native slash command (Claude Code: `/<name>`,
	// equivalent in Codex CLI / Gemini CLI). The adapter compiles
	// this to the vendor's slash-command surface; absent skills
	// remain plain prompt fragments.
	slashCommand?: {
		// Slash name without the leading slash. Conventional kebab-case.
		name: string
		// Argument hint shown in the vendor's slash-command picker.
		argumentHint?: string
		// Description shown alongside the command in the picker.
		description?: string
	}

	// Dispatch-router fields per SPEC §7.1.6 — optional on every skill,
	// required + closed on #DispatchRouterSkill. Lifted from
	// #DispatchRouterSkill onto #Skill so the harness `skills:` map
	// (typed [string]: #Skill) can carry router declarations directly
	// without an unrepresentable type-union. The Go IR (internal/ir/
	// types.go) has had these fields on the base Skill struct since
	// v1.0; the schema gap was the only thing keeping CUE manifests
	// from declaring routers.
	scoring?: {
		mode:      *"hybrid" | "keyword" | "llm-judge"
		llmModel?: string
		costBudgetPerCall: {
			usd:  float & >=0
			unit: *"call" | "session"
		}
	}
	confidenceFloor?: float & >=0 & <=1
	targets?: [...string]
	emit?: {
		sensor:      *"agent.dispatch.recommendation" | string
		nonBlocking: true
	}
}

// #DispatchRouterSkill — SPEC.md §7.1.6. Orchestration HINT layer.
//
// Load-bearing constraint (v1.0.7 anti-orchestration-overreach correction):
// the router NEVER blocks. It either emits a recommendation as additional
// context (vendor-native non-blocking surface) or stays silent. The
// `nonBlocking` field is constrained to `true` — a manifest setting it to
// `false` is rejected at lint time (negative eval neg/l2/router-blocks).
//
// Field shape follows SPEC.md §7.1.6 — scoring is nested under `scoring`,
// not flattened to top level.
// #DispatchRouterSkill pins the optional router fields on #Skill to
// required + tightens confidenceFloor's minimum to 0.6 per SPEC §7.1.6.
// Authors who want the typed convenience use this; #Skill with the
// optional router fields is also legal and the route taken by the
// claude-code adapter's findDispatchRouter() (which keys on
// taxonomy == "dispatch").
#DispatchRouterSkill: #Skill & {
	taxonomy: "dispatch"
	scoring: _
	scoring: costBudgetPerCall: _
	confidenceFloor: float & >=0.6 & <=1
	targets: [...string]
	emit: _
	emit: nonBlocking: true
}
