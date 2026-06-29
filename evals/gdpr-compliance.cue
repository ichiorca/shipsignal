package main

// PROJECT-SPECIFIC GDPR rails gate. T5 (spec 010) filled the grader with real checks and
// flipped it to ENFORCE: failure="block-change" + a "pre-commit" trigger. The grader proves
// redact-before-use, a Guardrail PII/sensitive-info policy, log scrubbing, data-subject
// erasure across Aurora+S3 (Art.17), access/export gated by escalation (Art.15), and
// retention/TTL (Art.5(1)(e)). passCriteria minPass=1.0 → any failed check blocks the change
// (constitution §5/§6: GDPR rails are non-negotiable; privacy evals gate at zero failures).
harness: evals: "gdpr-compliance": {
	name:      "gdpr-compliance"
	lifecycle: "ga"
	owner:     "spec-010"
	kind:      "capability"
	target: {kind: "primitive", ref: "gdpr"}
	graders: [{kind: "code", configRef: "evals/graders/gdpr-compliance.sh"}]
	passCriteria: {kind: "pass-at-k", k: 1, minPass: 1.0}
	costBudget: {maxUsd: 0.0, maxTokens: 1}
	triggers: ["pre-commit", "on-demand"]
	fixturesDir: "evals/fixtures/gdpr-compliance"
	failure: "block-change"
}
