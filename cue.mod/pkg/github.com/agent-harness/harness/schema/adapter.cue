package schema

// #AdapterContract — root type. Declares how a reference adapter binds the
// canonical IR to a specific vendor's harness. SPEC.md §4.5.
//
// The four-field shape is non-negotiable: `target`, `compiles`, `degradations`,
// `outputPaths`. Adapter binary behaviour (refusing dangerous flags, version
// checks, secret-broker injection) is documented in the adapter binary, NOT
// in the IR contract.
#AdapterContract: {
	// Required structural metadata; NEVER agentVisible.
	name:         string
	lifecycle:    "alpha" | "beta" | *"ga" | "deprecated"
	owner:        string
	agentVisible: false // structural; compile-time deny

	// Adapter target — vendor + product + minimum version.
	target: {
		vendor:  string // "Anthropic" | "OpenAI" | "Google" | ...
		product: string // "claude-code" | "codex-cli" | "gemini-cli"
		// minVersion is intentionally TBD until verified against vendor docs.
		minVersion?: string
	}

	// Which IR primitives the adapter can compile to vendor-native trees.
	compiles: [...#CompilesEntry]

	// Documented degradations — primitives this adapter cannot fully express.
	degradations: [...#Degradation]

	// Output paths the adapter writes when `harness sync` is invoked.
	outputPaths: [...string]
}

#CompilesEntry: {
	// Root type name being compiled.
	root: "Harness" | "Skill" | "Agent" | "Hook" | "Tool" |
	      "Authorization" | "AuthorizationPolicy" | "Sandbox" |
	      "Eval" | "Sensor" | "FixtureTemplate" | "AdapterContract" |
	      "ProvenancePolicy"

	// Vendor-native artifact the adapter emits.
	to: string
}

#Degradation: {
	// What the adapter cannot do.
	primitive: string
	// Why — short technical reason.
	reason: string
	// Workaround the adapter falls back to (or "none").
	workaround: *"none" | string
	// Dated review note — when this degradation was last verified.
	reviewedAt: string // RFC3339 date
}
