package schema

import "github.com/agent-harness/harness/schema/shared"

// #Harness — top-level root. A project's `harness.cue` unifies against this.
// References by name into the other 12 root types compose at load time.
#Harness: {
	// Required structural metadata; NEVER agentVisible.
	schemaVersion: shared.#SemVer & "1.0.0"
	metadata:      #Metadata
	agentVisible:  false // structural; compile-time deny

	// Top-level component sets. Each is a map keyed by the component's name.
	// Names MUST be unique across the keyspace of each root type.
	skills?:               [string]: #Skill
	agents?:               [string]: #Agent
	// workflows — §4.2 root type. Claude Code dynamic workflows (JS
	// subagent-orchestration scripts). Gated by
	// featureFlags.standard_l4_dynamic_workflows.
	workflows?:            [string]: #Workflow
	hooks?:                [string]: #Hook
	tools?:                [string]: #Tool
	authorizations?:       [string]: #Authorization
	authorizationPolicies?: [string]: #AuthorizationPolicy
	sandboxes?:            [string]: #Sandbox
	evals?:                [string]: #Eval
	sensors?:              [string]: #Sensor
	fixtureTemplates?:     [string]: #FixtureTemplate
	adapters?:             [string]: #AdapterContract
	provenancePolicies?:   [string]: #ProvenancePolicy

	// Spec packs — external-protocol conformance bundles (e.g. ACP,
	// UCP, AP2, A2A). Each pack ships versioned exit criteria, tool
	// requirements, and skill version pins that merchant features
	// reference by id. Adopt via `harness spec-pack adopt <path>`;
	// see schema/spec_pack.cue for the type. Additive: existing
	// harness installs with no spec packs declared are unaffected.
	specPacks?:            [string]: #SpecPack

	// Secret broker declarations. Each entry names a secret the
	// agent can reference via `{{secret:<name>}}` handles in tool
	// inputs; the adapter resolves the handle via the broker before
	// the call dispatches. Values never reach the L1 event log
	// (TECH-SPEC §3.13 + §10.x). Tier-0 implementation reads from
	// OS env / file / OS keyring per #Secret.source.kind.
	secrets?:              [string]: #Secret

	// Active sandbox / authorization-policy / provenance-policy selection.
	active: {
		sandbox:            string // references a key in sandboxes
		authorizationPolicy: string
		provenancePolicy:    string
	}

	// Cost-cap thresholds per SPEC.md §3.1 + §6.5, plus the recipe-
	// specific per-feature / per-loop caps from TECH-SPEC §7B.12.
	costCap: {
		interactive?: shared.#CostBudget
		autonomous:   shared.#PerLoopBudget
		idle?:        shared.#CostBudget
		// perFeatureBudget caps a single feature attempt under the long-
		// running-agent recipe. Exhaustion forces the feature back to
		// passes: false; the coding-agent moves on (or surfaces).
		perFeatureBudget?: #PerFeatureBudget
		// perLoopBudget caps the autonomous-state per-day spend. Exhaustion
		// transitions the state machine to Terminating. wallTimeHours is
		// an optional wall-clock cap unique to this scope.
		perLoopBudget?: #PerLoopRecipeBudget
	}

	// #PerFeatureBudget — TECH-SPEC §7B.12. At least one of maxUsd /
	// maxTokens must be set.
	#PerFeatureBudget: {
		maxUsd?:    float & >=0
		maxTokens?: int & >=0
		// onExhausted defaults to "force-pending" — the runtime flips the
		// feature back to passes: false and rotates the worker to the next
		// ready feature. "abort" surfaces to the human.
		onExhausted: *"force-pending" | "abort"
	}

	// #PerLoopRecipeBudget — TECH-SPEC §7B.12. Adds wallTimeHours to the
	// generic CostBudget shape.
	#PerLoopRecipeBudget: {
		maxUsd?:        float & >=0
		maxTokens?:     int & >=0
		wallTimeHours?: int & >=0
		onExhausted: *"terminate" | "warn"
	}

	// Sagas — TECH-SPEC §10.4. Long-running multi-step writes whose
	// compensation order is orchestrated by the harness.
	sagas?: [string]: #Saga

	// MCP server registry (sub-type, not a root type).
	mcpServers?: [string]: #MCPServer

	// workflowPolicy — sub-type governance lever for dynamic workflows.
	// enabled=false compiles "disableWorkflows": true into settings.json.
	workflowPolicy?: #WorkflowPolicy

	// L1 visibility config — OTel + event-log retention (TECH-SPEC §4.3).
	visibility?: #Visibility

	// Feature flags per TECH-SPEC §11.6. Project-scope flags that gate
	// Standard primitive activation. New adopters start with Core flags
	// on and Standard flags off; they flip Standard flags on as they're
	// ready. Changes require a session restart — see
	// internal/featureflag for the runtime semantics.
	featureFlags?: #FeatureFlags
}

// #FeatureFlags — enumerated Standard-primitive gates per §11.6.
// Each flag defaults to "off"; adopters opt in. The Core flags
// (sandbox, event-log, etc.) are always on and not listed here.
#FeatureFlags: {
	standard_l2_dispatch?:           "on" | *"off"
	standard_l3_saga?:               "on" | *"off"
	standard_l3_cqrs?:               "on" | *"off"
	standard_l3_circuit_breaker?:    "on" | *"off"
	standard_l3_backpressure?:       "on" | *"off"
	standard_l3_async?:              "on" | *"off"
	standard_l4_imp_at_k?:           "on" | *"off"
	standard_l4_drift_gardener?:     "on" | *"off"
	standard_l4_ab_testing?:         "on" | *"off"
	standard_l4_pattern_extraction?: "on" | *"off"
	// Standard L4 — Claude Code dynamic workflows (#Workflow root type).
	// Off by default; the harness compiles + governs workflows only when on.
	standard_l4_dynamic_workflows?: "on" | *"off"
	// Phase 11 — spec-kit interop layer (TECH-SPEC §13). Off by
	// default; the harness MUST work identically without it.
	phase_11_spec_kit_interop?: "on" | *"off"
}

// #Visibility — operator-controlled L1 surface configuration.
#Visibility: {
	otel?: {
		enabled?: *true | false
		// "file"  → JSONL exporter writing to .harness/state/otel/
		// "otlp-grpc" / "otlp-http" → external collector
		exporter?: *"file" | "otlp-grpc" | "otlp-http"
		endpoint?: string | *""
		sampling?: {
			traces?: *"always" | "ratio"
			ratio?:  float & >0 & <=1
		}
	}
	eventLog?: {
		backend?:   *"jsonl" | "sqlite" | "postgres" | "clickhouse"
		retention?: *"30d" | "90d" | "forever"
	}
}

#Metadata: {
	// Display name (operator-friendly).
	name: string

	// Repository URL or local marker.
	repo?: string

	// linkedSpec — advisory pointer for spec-kit interop per docs/spec-kit-interop.md.
	linkedSpec?: string

	// Owner / contact.
	owner: string

	// Free-form description.
	description?: string

	// briefConstraints — extra rule lines surfaced verbatim under
	// "Implementation rules" in briefs produced by
	// `harness spec-kit brief` / `harness spec-kit implement`.
	// Project-specific text the harness can't infer (e.g.
	// "do not import sklearn", "writes must use the connection pool").
	briefConstraints?: [...string]

	// briefSkipTests — when true, generated briefs include the
	// canonical "do not run the project test suite" line. Folds the
	// most common project rule into a single flag so simple projects
	// don't need to populate briefConstraints. The harness still runs
	// the suite itself via testCommand when --run-tests is set.
	briefSkipTests?: *false | true

	// testCommand — shell command the harness invokes after a
	// `spec-kit implement` pass when --run-tests is set. Captured
	// stdout/stderr is summarised on the L1 event log as
	// tool.test.run. Empty means "no test command configured" and
	// `--run-tests` becomes an error.
	testCommand?: string

	// billingMode — how the operator is billed for adapter LLM use.
	// "api"          — usage-based via the vendor's API. Cost telemetry
	//                  multiplies tokens × per-model rate (rates.json)
	//                  and emits cost.tick events with a USD figure.
	// "subscription" — Claude.ai Pro/Max / Codex/Gemini subscription
	//                  account where per-token cost is bundled. The
	//                  harness still emits cost.tick events (for token
	//                  counts) but with `usd: 0` + `billingMode:
	//                  "subscription"` so dashboards show usage, not
	//                  fake spend.
	// Default: "api" preserves current behaviour for existing projects.
	billingMode?: *"api" | "subscription"

	// briefMaxPriorPassLogs caps the number of prior progress/pass*.log
	// files surfaced as inputs in a generated brief. Older logs are
	// collapsed into a single summary line so context doesn't grow
	// unbounded as a multi-spec build progresses (Gap R). Default 3.
	briefMaxPriorPassLogs?: int & >=0 | *3

	// architecture — declared import-edge rules + private-access
	// policy used by `harness spec-kit review`. See #Architecture.
	architecture?: #Architecture

	// completeness — knobs for `harness spec-kit completeness`.
	// Used to suppress known false-positives that the static
	// detectors can't disambiguate. Example: a module exposed
	// via a Protocol seam that's intentionally not yet wired
	// (the alternative implementation lands in a later spec).
	completeness?: #Completeness

	// eval — knobs for `harness eval *` commands. Today only
	// profileBudget; future Gap EVAL3 work may add per-rubric or
	// per-axis controls. See docs/proposals/gap-EVAL3-*.md.
	eval?: #EvalMetadata

	// adapter — per-adapter runtime knobs (Gap ZZ). Distinct from
	// the top-level `adapters:` map (which declares contracts).
	adapter?: {
		claudeCode?: {
			// hookScope picks where settings.json is installed:
			//   "project" (default) — <projectRoot>/.claude/settings.json
			//                          (hooks fire only when Claude is
			//                          launched from this project tree)
			//   "user"              — ~/.claude/settings.json
			//                          (legacy — fires globally; harness
			//                          early-returns in non-harness cwd)
			hookScope?: *"project" | "user"
		}
		geminiCli?: {
			// P4: same shape as claudeCode.hookScope. Default project.
			hookScope?: *"project" | "user"
		}
	}
}

// #EvalMetadata — Gap EVAL3a profile-level cost budgets. The
// harness eval run path sums cost.tick events emitted during the
// profile run and fires harness.eval.profile-cost-overrun when the
// total exceeds the budget for that profile. Per-eval budgets remain
// independent (existing metadata.evalCostBudget mechanism).
#EvalMetadata: {
	// profileBudget — dollar cap per single profile run. Total
	// cost.tick.usd across all evals in the named profile must stay
	// at or below this number. 0 or unset = no profile-level cap.
	profileBudget?: {
		core?:     number & >=0
		standard?: number & >=0
		extended?: number & >=0
	}
}

// #Architecture — project-declared layering rules surfaced to the
// review walker. Each rule is a glob-based "from" → list of allowed
// "to" globs. Imports that don't match any rule's "to" set OR that
// match a "from" with no matching "to" are flagged.
//
// The walker is best-effort language-aware: today it understands
// Python `from X import Y` / `import X.Y`. Other languages get
// extended over time; the schema is stable.
//
// internalPrefix scopes the check to imports of the project's own
// modules. Stdlib + 3rd-party imports (anything not starting with
// `internalPrefix`) are exempt — operators don't have to whitelist
// every `from typing import` line. Set to e.g. "bookshelf" for a
// project rooted at src/bookshelf/.
#Architecture: {
	allowedImports?: [...{
		from: string
		to:   [...string]
	}]
	forbidPrivateCrossModuleAccess?: *false | true
	internalPrefix?: string
}

// #Completeness — project-declared overrides for the HC1-HC5
// detectors. Today only HC1's unreachable-module list has tunable
// behavior; this block is the seam for HC2-HC5 overrides as the
// detectors grow new false-positive surfaces.
//
// ignoreUnreachable — dotted module paths the HC1 detector should
// NOT flag. Reserved for modules the scanner can't statically prove
// reachable but the operator knows ARE reachable (decorator-based
// plugin registration, dependency-injected Protocol seams awaiting
// a later spec's concrete implementation, etc.). Use sparingly —
// the detector is more valuable when it catches real wiring gaps.
#Completeness: {
	ignoreUnreachable?: [...string]
	// ignoreDeadKnob — `funcName.paramName` entries the dead-knob
	// review axis should NOT flag, even when a *Settings class
	// declares a field of the same name. Use when the same-name
	// match is coincidental (e.g. a generic `threshold` shared by
	// unrelated function/settings pairs).
	ignoreDeadKnob?: [...string]
	// ignoreDeadProtocolHook — entries the dead-protocol-hook
	// review axis should NOT flag. Three shapes:
	//   "method"                            — silences globally
	//   "field.method"                      — silences for one field
	//   "EnclosingClass.field.method"       — most specific
	// Use when an optional hook is genuinely meant to be absent on
	// some sources (e.g. an OnFoo callback only some sources emit).
	ignoreDeadProtocolHook?: [...string]
	// ignoreParamCallers — F001 (param-callers) silencing entries.
	// Three shapes:
	//   "funcName.paramName"  — most specific
	//   "funcName"            — silences every param on the function
	//   "*.paramName"         — silences a param name across functions
	// Use for genuinely-internal kwargs the operator has documented
	// as not-meant-to-be-passed-by-name (testability or future-API
	// reserved slot). Keep the list short and audit periodically.
	ignoreParamCallers?: [...string]

	// --- Input locations (HC1-HC5 sources) ---
	//
	// Mirror the `harness spec-kit completeness` CLI flags so the bare
	// invocation made by the native Stop hook (which passes no flags)
	// can discover a project's layout. CLI flags take precedence; these
	// are the fallback. Without them, completeness defaults to a
	// top-level `src/` and HARD-FAILS on monorepo/non-`src` layouts,
	// silently blocking the Stop hook's autocommit/autotag.
	srcRoots?: [...string]
	entryPoints?: [...string]
	migrationGlobs?: [...string]
	specGlobs?: [...string]
	docGlobs?: [...string]
}

// #MCPServer — Model Context Protocol server registration. SPEC.md §3.11b.
#MCPServer: {
	name: string

	// Transport.
	transport: "stdio" | "http+sse" | "streamable-http"

	// Endpoint or command.
	endpoint?:   string // for http+sse / streamable-http
	command?:    string // for stdio
	args?:       [...string]
	env?:        [string]: string

	// Provenance class assigned to responses.
	provenance: "mcp-internal" | "mcp-external"

	// Whether to scan ingress for secrets/PII.
	ingressScan: *false | true

	// Cost attribution (operator-provided estimate for budget tracking).
	costAttribution?: {
		perCallUsd?: float & >=0
	}
}
