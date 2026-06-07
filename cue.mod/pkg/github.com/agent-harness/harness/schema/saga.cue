package schema

// #Saga — TECH-SPEC §10.4. A sequence of write-class tool calls each
// paired with a compensating action that undoes the forward effect.
// The harness orchestrator executes the sequence; on failure it
// invokes compensations in reverse order. Agents declare the saga;
// the runtime orchestrates the rollback path — the agent does NOT
// build the compensation order.
#Saga: {
	name:         string
	lifecycle:    "alpha" | "beta" | *"ga" | "deprecated"
	owner:        string
	agentVisible: *true | false
	description?: string

	// Steps execute in order; on any forward failure the runtime
	// invokes the prior steps' compensations in reverse order.
	steps: [...#SagaStep]

	// onPartialCompensation — what to do if a compensation itself
	// fails. Default: log the partial-rollback and escalate to L4
	// governance for human attention (neg/l3/saga-partial-compensation).
	onPartialCompensation: *"escalate" | "ignore" | "retry"
}

#SagaStep: {
	// forward — the write-class tool invocation that, on failure,
	// triggers reverse-order compensations.
	forward: #SagaInvocation

	// compensation — the tool invocation that undoes `forward`'s
	// effect. The runtime invokes it on rollback even when the
	// forward succeeded (e.g., a later step failed).
	compensation: #SagaInvocation
}

#SagaInvocation: {
	tool:  string
	input: {...}
}
