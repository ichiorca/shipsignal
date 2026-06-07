package schema

// #FeatureList — the central state object for the long-running-agent
// recipe (SPEC §10, TECH-SPEC §7B.4). Stored at
// progress/feature_list.json under the project root. The path is L0-
// protected: only the harness binary may write it, and writes go
// through `harness feature mark-passing <id>` which is eval-gated.
#FeatureList: {
	schemaVersion: "feature-list.v1"
	features: [...#Feature]
}

#Feature: {
	// Stable id for the feature; agent references this in worker-report.v1
	// and the dependency graph. Kebab-case + ordinal suffix recommended
	// (e.g. "openapi-001").
	id: string

	// Optional grouping label used by the coding-agent's bearings step to
	// scope universal memory reads.
	category?: string

	// One-line user-facing description. Free text.
	description: string

	// verificationSteps[] is the eval-gate: when the agent calls
	// `feature.mark-passing`, the harness compiles each entry into an
	// `#Eval` and runs them. Every step must succeed before the runtime
	// flips `passes: false → true` and rewrites the file.
	//
	// **S6 migration (2026-05-27)**: this field was previously named
	// `verification_steps` (snake_case). The Go IR's UnmarshalJSON
	// still accepts the legacy key from feature_list.json files on
	// disk; the canonical CUE schema declares camelCase only.
	verificationSteps: [...string]

	// Promotion state — flips from false to true atomically when
	// verificationSteps pass. The agent CANNOT write this field directly;
	// only the harness CLI can.
	passes: *false | true

	// Priority bucket. Determines worker selection order at session start.
	priority: "P0" | "P1" | "P2" | *"P2"

	// Sibling feature ids this feature requires. Each entry MUST resolve
	// to an existing feature; when the dependency transitions to
	// passes: true, the runtime atomically removes the id from this
	// feature's dependencies array (TECH-SPEC §7B.4 cascade rule).
	dependencies: [...string]
}
