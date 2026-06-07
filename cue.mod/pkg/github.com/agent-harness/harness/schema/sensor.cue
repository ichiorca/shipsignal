package schema

import "github.com/agent-harness/harness/schema/shared"

// #Sensor — root type. A non-blocking event-emitter. SPEC.md §7.3.
#Sensor: {
	// Required structural metadata; NEVER agentVisible.
	name:         string
	lifecycle:    "alpha" | "beta" | *"ga" | "deprecated"
	owner:        string
	agentVisible: false // structural; compile-time deny

	// One of the recognised sensor categories per SPEC.md §7.3.
	category:
		"performance-trend" |
		"output-distribution" |
		"rubber-stamp" |
		"dispatch-recommendation" |
		"plateau-detection" |
		"retry-threshold" |
		"high-risk-tag" |
		"custom"

	// Condition under which the sensor fires; references the canonical event taxonomy.
	fireCondition: shared.#MatchPredicate

	// Event kind emitted when condition matches. Names follow `agent.<scope>.<verb>` per SPEC §7.3.
	emits: string

	// Whether the event is visible to subsequent agent context windows.
	surfaceToAgent: *true | false

	// Thresholds — sensor-specific. Validated at runtime.
	thresholds?: [string]: float | int | string

	// §3.15.2 determinism boundary. A deterministic sensor MUST NOT
	// consume stochastic inputs (model outputs, web-fetched content,
	// time-of-day) without explicitly opting in via
	// acceptStochasticity. Lint refuses the combination unless
	// acceptStochasticity is true, in which case it surfaces a
	// warning so reviewers see the explicit choice.
	kind?:                "deterministic" | *"stochastic"
	inputs?:              [...string]
	acceptStochasticity?: *false | true
}
