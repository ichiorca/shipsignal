package main

// T5 (spec 010) — the §6 quality-bar PRIVACY EVAL SUITE, wired as a BLOCKING gate.
// Three categories (redaction-integrity, pii-phi-exposure, claim-provenance-accuracy) gate
// at zero failures: passCriteria minPass=1.0 means any CRITICAL/HIGH miss fails the eval, and
// failure="block-change" + the "pre-commit" trigger stop the change from landing
// (constitution §6: "privacy/domain evals pass with CRITICAL and HIGH gates at zero failures
// before deploy"). The grader is a pure code check (no LLM) → zero cost budget.
harness: evals: "privacy-eval": {
	name:      "privacy-eval"
	lifecycle: "ga"
	owner:     "spec-010"
	kind:      "regression"
	target: {kind: "primitive", ref: "privacy"}
	graders: [{kind: "code", configRef: "evals/graders/privacy-eval.sh"}]
	// minPass 1.0 over k=1 → the single run must fully pass; one category failure blocks.
	passCriteria: {kind: "pass-at-k", k: 1, minPass: 1.0}
	costBudget: {maxUsd: 0.0, maxTokens: 1}
	triggers: ["pre-commit", "on-demand"]
	fixturesDir: "evals/fixtures/privacy-eval"
	failure:     "block-change"
}
