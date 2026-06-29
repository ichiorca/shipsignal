package main

// T4 (spec 011) — the §6 quality-bar COST/LATENCY EVAL GATE, wired as a BLOCKING gate.
// Three categories (tier-routing-tracked, budget-enforced, telemetry-pii-free) gate at zero
// failures: passCriteria minPass=1.0 means any CRITICAL/HIGH miss fails the eval, and
// failure="block-change" + the "pre-commit" trigger stop the change from landing
// (constitution §6: "Cost/latency: LLM pipeline stays within its token/latency budget eval
// gate; no untracked model-tier upgrades"). The grader is a pure code check + the cost unit
// tests (no LLM, no DB, no AWS) → zero cost budget.
harness: evals: "cost-latency": {
	name:      "cost-latency"
	lifecycle: "ga"
	owner:     "spec-011"
	kind:      "regression"
	target: {kind: "primitive", ref: "bedrock"}
	graders: [{kind: "code", configRef: "evals/graders/cost-latency.sh"}]
	// minPass 1.0 over k=1 → the single run must fully pass; one category failure blocks.
	passCriteria: {kind: "pass-at-k", k: 1, minPass: 1.0}
	costBudget: {maxUsd: 0.0, maxTokens: 1}
	triggers: ["pre-commit", "on-demand"]
	fixturesDir: "evals/fixtures/cost-latency"
	failure:     "block-change"
}
