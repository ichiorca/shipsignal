package schema

import "github.com/agent-harness/harness/schema/shared"

// #Eval — root type. A verifiable evaluation entry. SPEC.md §13.1.
#Eval: {
	// Required structural metadata; NEVER agentVisible.
	name: string

	// Lifecycle states. `"stable"` is the canonical reference-eval
	// classification used across the entire `evals/` tree — every
	// conformance entry is published as "stable". Standard alpha/beta/
	// ga progression remains available for project-local evals.
	lifecycle:    "alpha" | "beta" | *"ga" | "stable" | "deprecated"
	owner:        string
	agentVisible: false // structural; compile-time deny

	// Kind — 4 kinds. SPEC.md §13.1.
	kind: "capability" | "regression" | "property" | "counterfactual"

	// Target — the primitive this eval verifies.
	target: #EvalTarget

	// Graders — composed of code / model / human entries.
	graders: [...#Grader]

	// Pass criteria.
	passCriteria: #PassCriteria

	// Cost budget — required dual-unit with binding-min semantics.
	costBudget: shared.#CostBudget

	// Triggers — when the eval runs.
	triggers: [...#EvalTrigger]

	// Reproducibility.
	seed?:      int
	seedRange?: int
	runs:       *5 | int & >0

	// Fixtures directory (content-addressed).
	fixturesDir: string

	// Failure semantic.
	failure: *"block-change" | "warn" | "open-issue" | "record-only"
}

#EvalTarget: {
	// `"primitive"` is the bucket the reference eval-set uses for
	// non-vendor-specific harness primitives (broker decision tables,
	// L3 middleware contracts, recipe-shaped flows). Schema-typed root
	// references (skill / agent / hook / tool / sandbox) remain
	// available for project-local evals.
	kind: "skill" | "agent" | "hook" | "tool" | "sandbox" | "primitive"
	ref:  string
}

#Grader: #CodeGrader | #ModelGrader | #HumanGrader

#CodeGrader: {
	kind:       "code"
	configRef:  string // points to grader code
}

#ModelGrader: {
	kind:      "model"
	rubricRef: string
	model:     string
	dimensions: [...string]
}

#HumanGrader: {
	kind:     "human"
	sopRef:   string
	slaHours: *24 | int & >0
}

#PassCriteria: #PassAtK | #PassPowK | #DivergenceThreshold | #Composite

#PassAtK: {
	kind:    "pass-at-k"
	k:       int & >=1
	minPass: float & >=0 & <=1
}

#PassPowK: {
	kind:    "pass-pow-k"
	k:       int & >=1
	minPass: float & >=0 & <=1
}

#DivergenceThreshold: {
	kind:         "divergence"
	maxDivergence: float & >=0 & <=1
}

#Composite: {
	kind: "composite"
	all: [...#PassCriteria]
}

#EvalTrigger: "pre-commit" | "on-promote" | "nightly" | "on-demand"
