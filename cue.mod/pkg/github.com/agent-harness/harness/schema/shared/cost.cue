package shared

// #CostBudget — dual-unit budget with binding-min semantics per SPEC.md §6.5.1.
// Run aborts when ANY declared limit is reached first. At least one of
// maxUsd / maxTokens / maxModelCalls must be set.
#CostBudget: {
	maxUsd?:        float & >=0
	maxTokens?:     int & >=0
	maxModelCalls?: int & >=0
	// toolCallRate — session-level rate cap in calls per minute,
	// per TECH-SPEC §10.6. 0 = unlimited.
	toolCallRate?: int & >=0

	// Action when budget is exhausted.
	onExhausted: *"terminate" | "warn" | "block"

	// How aggressively the runtime warns approaching the cap.
	// "soft" — emit sensor event at 80%.
	// "hard" — emit sensor event at 80% AND deny further calls.
	approachPolicy: *"soft" | "hard"
}

// #CostBudget admits the per-loop variant used by autonomous-mode cron jobs.
#PerLoopBudget: #CostBudget & {
	maxUsd?:        float & >0
	maxTokens?:     int & >0
	maxModelCalls?: int & >0
}
