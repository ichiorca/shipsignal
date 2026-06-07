package schema

// #WorkerReport — TECH-SPEC §7B.6. The coding-agent emits one of these
// at the end of each feature attempt; the harness reads it from
// .harness/state/active-feature/worker-report.json before deciding
// whether to allow `feature.mark-passing`.
//
// The PreToolUse hook (Claude Code) / approval-policy granular rule
// (Codex) / BeforeTool hook (Gemini) consult this report and DENY when
// any rule has `verified: false` or `evidence: ""`. The mechanical-block
// chain is documented in §7B.6 step-by-step.
#WorkerReport: {
	schemaVersion: "worker-report.v1"

	// taskId echoes the feature id from progress/feature_list.json. The
	// harness uses it to locate the matching feature and run its
	// verification_steps.
	taskId: string

	// selfReview entries are the worker's claim that each rule passed.
	// Empty `evidence` is treated as "did not actually verify" — the
	// pre-tool hook denies on that signal.
	selfReview: [...#WorkerReportRule]

	// effortApplied is a coarse self-assessment used by Phase 9
	// governance to spot agents reporting "high" effort with no diff.
	effortApplied: "low" | "medium" | "high"

	// turnsUsed counts conversation turns the worker consumed reaching
	// the report. Used alongside cost.tick events for cost attribution.
	turnsUsed: int & >=0

	// summary is a free-text paragraph the worker writes for the
	// reviewer (and for the L1 event log). Not consumed by the hook.
	summary: string
}

#WorkerReportRule: {
	// rule names a rule from the project's default-or-extended rule set
	// (§7B.6 lists the 5 defaults: dry-violation-none,
	// feature-list-markers-untouched, all-declared-symbols-called,
	// acceptance-items-verified-with-evidence, no-existing-test-regression).
	rule: string

	// verified is the worker's pass/fail claim. False = block.
	verified: bool

	// evidence MUST be non-empty when verified=true. The pre-tool hook
	// treats an empty string as "the worker rubber-stamped the rule" and
	// blocks the feature.mark-passing call (neg/long-running/worker-rubber-stamp).
	evidence: string
}
