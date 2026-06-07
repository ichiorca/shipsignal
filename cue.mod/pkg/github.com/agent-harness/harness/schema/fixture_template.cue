package schema

import "list"

// #FixtureTemplate — root type added in SPEC.md v1.0.10. Human-authored truth
// claim from which a separate fixture-generator agent instantiates concrete
// HTAG fixtures.
//
// The load-bearing property: the *task agent* never decides what is verified.
// The template carries the truth claim; the fixture-generator instantiates;
// a human approves before commit.
#FixtureTemplate: {
	// Required structural metadata; NEVER agentVisible.
	name:         string
	lifecycle:    "alpha" | "beta" | *"ga" | "deprecated"
	owner:        string
	agentVisible: false // structural; compile-time deny

	// Behaviour the template captures. Required to be specific; vague phrases
	// like "various scenarios" are caught by `harness lint --strict` per §9.6.
	behavior: string

	// Why this behaviour matters. Forwarded into the fixture rationale.
	rationale: string

	// Enumerated edge cases. Empty list rejected at lint time per §9.6.
	edgeCases: [...string] & list.MinItems(1)

	// Anti-patterns the template prohibits the generator from producing.
	antiPatterns?: [...string]

	// Generator agent name (must reference a #Agent with taxonomy =
	// "fixture-generator" and non-overlapping authorizations vs task agent).
	generatorAgent: string

	// Reviewer set — human reviewers authorized to approve generated fixtures.
	// The pre-commit hook rejects fixtures with reviewedBy: null.
	reviewerSet: [...string] & list.MinItems(1)
}
