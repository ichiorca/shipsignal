package schema

// #Sandbox — root type. Declares the OS-level isolation profile and the
// blast-radius limits the harness enforces around tool calls.
#Sandbox: {
	// Required structural metadata; NEVER agentVisible.
	name:         string
	lifecycle:    "alpha" | "beta" | *"ga" | "deprecated"
	owner:        string
	agentVisible: false // structural; compile-time deny

	// Tier of the sandbox profile per SPEC.md §5.
	tier: "tier-0" | "tier-1" | "tier-2"

	// OS-level isolation strategy. The reference adapter binds these to:
	//   linux       → Landlock LSM + seccomp filters
	//   darwin      → sandbox-exec (sbpl)
	//   windows     → WSL with linux profile (v1.x; native Job Objects = Tier-1 future work)
	isolation: {
		linux?:   #LinuxIsolation
		darwin?:  #DarwinIsolation
		windows?: #WindowsIsolation
	}

	// Workspace + protected paths. The agent may read/write inside workspaceRoot
	// except for protectedPaths, which require runtime-mediated writes.
	workspaceRoot:   string
	protectedPaths: [...#ProtectedPath]

	// Default network policy: deny except allowlisted hosts.
	// "allow" and "permit" are accepted as synonyms so the same
	// vocabulary works whether you're reading the sandbox spec or
	// the authorization-policy defaults (which historically used
	// "permit"). IR resolve normalises whichever form arrives.
	network: {
		policy: *"deny" | "allow" | "permit"
		allowlist: [...#NetworkHost]
	}

	// Per-tool blast-radius caps (defaults; per-tool overrides on #Tool).
	blastRadius: #BlastRadius

	// Degraded-environment fallback policy. SPEC.md §3.14.
	degradedFallback: "refuse-to-run" | *"accept-degraded-with-audit" | "substitute-and-warn"
}

#LinuxIsolation: {
	landlock: *true | false
	seccomp:  *true | false
}

#DarwinIsolation: {
	sandboxExec: *true | false
	sbplProfile: string | *""
}

#WindowsIsolation: {
	// v1.x: WSL shim invokes the linux profile inside WSL.
	// Native Windows (Job Objects + AppContainer) is Tier-1 future work.
	wsl: *true | false
}

#ProtectedPath: {
	glob:    string
	reason:  string
	// actorScope restricts the deny to specific actor classes; empty = all.
	actorScope?: [...#ActorScope]
}

#ActorScope: {
	// `agent` / `skill` / `tool` are the runtime-natural spellings the
	// per-adapter ActorRef emits at hook time; the dashed `agent-name`
	// / `agent-class` variants remain for explicit author preference.
	// matchesActor (internal/sandbox/sandbox.go:actorKindAliases) treats
	// all of these as one equivalence class — authors may use whichever
	// they find clearest.
	kind: "agent" | "skill" | "tool" | "agent-name" | "agent-class"
	name: string
}

#NetworkHost: {
	host: string
	port: *443 | int & >=0 & <=65535
	// Provenance class assigned to responses from this host.
	provenance: #ProvenanceClass | *"network"
}

#BlastRadius: {
	// Defaults per SPEC.md §3.13 (TECH-SPEC v0.3.0 — reduced from 1024 to 100).
	maxFileSizeMib:     *100 | int & >0
	maxFilesWritten:    *500 | int & >0
	maxSubprocesses:    *32 | int & >0
	maxCpuSeconds:      *900 | int & >0
	maxMemoryMib:       *4096 | int & >0
}
