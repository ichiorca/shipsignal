package schema

// #Tool — root type. An invokable capability surfaced to the agent. Tools wrap
// CLI commands, MCP server methods, or harness-internal helpers.
#Tool: {
	// Required structural metadata; NEVER agentVisible.
	name:         string
	lifecycle:    "alpha" | "beta" | *"ga" | "deprecated"
	owner:        string

	// Whether the tool's description, name, and JSON-schema are surfaced to the
	// agent. true for the vast majority of tools; false for runtime-internal
	// shims invoked by hooks rather than the model.
	agentVisible: *true | false

	// One-line agent-facing description; used by the dispatch router.
	description?: string

	// JSON-schema for input arguments, serialized as a CUE struct.
	inputSchema?: {...}

	// Provenance class assigned to the tool's output.
	outputProvenance: #ProvenanceClass

	// Per-tool blast-radius overrides; null entries inherit from #Sandbox.
	blastRadiusOverride?: {
		maxFileSizeMib?:  int & >0
		maxFilesWritten?: int & >0
		maxSubprocesses?: int & >0
		maxCpuSeconds?:   int & >0
		maxMemoryMib?:    int & >0
	}

	// Backing implementation.
	impl: #ToolImpl

	// Whether the tool is destructive (informs default-deny per
	// #AuthorizationPolicy.defaults.destructive).
	destructive: *false | true

	// Whether the tool causes network egress (informs default-deny).
	networkEgress: *false | true

	// L3 runtime conveniences per TECH-SPEC §10.

	// readClass / writeClass — CQRS routing per §10.7. Mutually
	// exclusive; mixed-class tools take the write path (safer default).
	readClass:  *false | true
	writeClass: *false | true

	// cacheClass — read-through cache declaration per §10.3. The lint
	// rule `checkCacheOnSideEffectFreeOnly` (negative eval
	// neg/l3/cache-on-side-effect) refuses cacheClass on writeClass=true
	// tools.
	cacheClass?: {
		ttl: "5m" | "1h" | "1d"
		keying: *"input-hash" | "url-only"
		// invalidateOn — event kinds whose appearance busts the cache
		// for this tool. Empty = TTL-only invalidation.
		invalidateOn?: [...string]
	}

	// circuitBreaker — per-tool 3-state machine per §10.5. Absent =
	// no breaker; the tool fails through to the upstream every call.
	// openDurationMillis, when non-zero, overrides openDurationSec
	// (sub-second fast-failover).
	circuitBreaker?: {
		failureRateThreshold: float & >=0 & <=1
		rollingWindowSec:     int & >=1
		minimumRequests:      int & >=1
		halfOpenProbeCount:   int & >=1
		openDurationSec:      int & >=1
		openDurationMillis?:  int & >=1
	}

	// concurrency — per-tool concurrency cap per §10.6. Excess
	// invocations queue with timeout. 0 = unlimited.
	concurrency?: int & >=0

	// async + callbackEvents — async-tool surface per §10.8. async=true
	// tools return a handle synchronously; terminal callback events in
	// the L1 log re-engage the agent's context.
	async: *false | true
	callbackEvents?: [...string]

	// costClass — per-call cost attribution per SPEC §4.4 + §3.13.
	// Required for any tool with non-trivial external cost; lint
	// refuses unbounded-blast-radius tools without it.
	// `unit` is the cost dimension ("token", "call", "byte", "computed");
	// `rate` is units-per-currency at the cited `currency` (USD by default).
	costClass?: {
		unit:     "token" | "call" | "byte" | "computed"
		rate:     float & >=0
		currency: *"USD" | "EUR" | "GBP"
	}
}

#ToolImpl: #ShellImpl | #McpImpl | #BuiltinImpl

#ShellImpl: {
	kind: "shell"
	// Path to a shell script file. Inline shell strings are an anti-pattern
	// per SPEC.md §12.3.
	bodyRef: string
}

#McpImpl: {
	kind:       "mcp"
	server:     string // #MCPServer.name
	methodName: string
}

#BuiltinImpl: {
	kind: "builtin"
	// Harness-internal helper (e.g., feature.mark-passing).
	name: string
}
