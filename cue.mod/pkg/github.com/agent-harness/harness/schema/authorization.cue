package schema

// #Authorization — root type. A single capability grant: who, what, in what scope.
#Authorization: {
	// Required structural metadata; NEVER agentVisible.
	name:         string
	lifecycle:    "alpha" | "beta" | *"ga" | "deprecated"
	owner:        string
	agentVisible: false // structural; compile-time deny

	// Subject — the actor receiving the grant.
	subject: {
		kind: "agent" | "skill" | "hook" | "tool" | "operator"
		ref:  string
	}

	// Capability granted.
	capability: #Capability

	// Provenance constraint — grant only applies when input provenance matches.
	provenance?: {
		classIn?:       [...#ProvenanceClass]
		trustLevelIn?:  [...#TrustLevel]
	}

	// Lifetime semantics.
	scope: "session" | "task" | "single-call" | "persistent"

	// Optional time-bound expiration.
	expiresAt?: string // RFC3339
}

// #Capability — what the subject is allowed to do.
//
// The schema enum lists every capability kind both adapters' runtimes
// emit. "destructive" / "write" / "read" / "sub-agent" / "skill-load"
// are the per-adapter equivalents the broker maps onto the canonical
// classes via internal/auth/broker.go subjectKindMatches +
// capabilityKindMatches alias tables — authors may write either spelling
// and the broker treats them as equivalent.
#Capability: {
	kind:
		"tool" |
		"network" |
		"secret" |
		"fs-write" |
		"fs-read" |
		"dispatch-agent" |
		"mcp-call" |
		"shell" |
		"destructive" |
		"write" |
		"write-tool" |
		"read" |
		"read-tool" |
		"sub-agent" |
		"skill-load" |
		"skills" |
		"subAgents" |
		"readTools"
	// Refinement by kind.
	target?: string
	verbs?: [...string]
}

// #AuthorizationPolicy — root type. Aggregates authorizations + default-permit /
// default-deny mode + the runtime broker config.
#AuthorizationPolicy: {
	// Required structural metadata; NEVER agentVisible.
	name:         string
	lifecycle:    "alpha" | "beta" | *"ga" | "deprecated"
	owner:        string
	agentVisible: false // structural; compile-time deny

	// Default decision when no #Authorization matches. SPEC.md §2.4:
	// skills / sub-agents / read tools default-permit;
	// network / secret / destructive default-deny.
	// "allow" is accepted as a synonym for "permit" so authorisation
	// policy defaults can use the same vocabulary as
	// sandbox.network.policy. The two layers historically forked on
	// the verb ("permit" vs "allow") for the same semantic concept;
	// operators tripped on the cliff. IR resolve normalises.
	defaults: {
		skills:       *"permit" | "allow" | "deny"
		subAgents:    *"permit" | "allow" | "deny"
		readTools:    *"permit" | "allow" | "deny"
		network:      *"deny"   | "permit" | "allow"
		secret:       *"deny"   | "permit" | "allow"
		destructive:  *"deny"   | "permit" | "allow"
	}

	// Engaged authorization records.
	grants: [...#Authorization]

	// Broker behaviour on inputs the policy declares require mediation.
	brokerMode: *"audit-and-deny" | "audit-only" | "deny-only"
}
