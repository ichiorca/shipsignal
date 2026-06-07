package main

import (
	schema "github.com/agent-harness/harness/schema"
)

harness: schema.#Harness & {
	schemaVersion: "1.0.0"
	metadata: {
		name:        "shipsignal"
		owner:       "me"
		testCommand: "npm test && pytest -q"
	}

	active: {
		sandbox:             "default"
		authorizationPolicy: "default"
		provenancePolicy:    "default"
	}

	costCap: {
		autonomous: {
			// The USD figure is an ESTIMATE (depends on the dev's plan/subscription),
			// so it warns rather than terminates — it must never kill a long
			// autonomous build on a fixed-price plan. Raise/lower as a soft signal.
			maxUsd:      100.0
			onExhausted: "warn"
		}
	}

	// Depth (L2/L3/L4 standard featureFlags) is provisioned by
	// `harness levels set` into the managed levels.cue — not hand-edited here.

	sandboxes: "default": {
		name:          "default"
		lifecycle:     "ga"
		owner:         "me"
		agentVisible:  false
		tier:          "tier-0"
		workspaceRoot: "."
		// Operator-authored artifacts the autonomous session must not
		// mutate. The last four are spec-kit-aware defaults — globs
		// that don't match anything yet are no-ops, so they're safe
		// to ship even before 'spec-kit init' runs.
		protectedPaths: [
			{glob: ".git/HEAD", reason: "git head must not be rewritten by tools"},
			{glob: ".harness/state/**", reason: "harness internal state"},
			{glob: ".harness/traces.jsonl", reason: "L1 audit log — tamper-evident; only the harness binary appends"},
			{glob: ".harness/traces.jsonl.*", reason: "L1 audit log rotated/locked variants"},
			{glob: ".harness/grants.sqlite*", reason: "session grants DB — only auth.Broker mutates"},
			{glob: "memory/constitution.md", reason: "constitutional invariants — operator-only edits"},
			{glob: "specs/*/spec.md", reason: "spec WHAT is operator-authored; agent edits plan/tasks only"},
			{glob: "docs/PRD.md", reason: "PRD is the source of truth — operator-only edits"},
			{glob: ".env", reason: "secrets — never written by the autonomous session"},
		]
		isolation: {
			windows: wsl: true
		}
		// Personal-use default: permit so the autonomous session can
		// 'uv sync' / 'npm install' / 'go mod download' / pull Docker
		// images on a fresh bootstrap. Tighten to "allowlist" (with
		// explicit hosts) or "deny" for multi-tenant / hostile-input
		// environments.
		network: {
			policy: "permit"
			allowlist: []
		}
		blastRadius: {
			maxFileSizeMib: 16
			// Bumped to accommodate a typical scaffolded project tree
			// (src/, tests/, migrations/, docs/, config/) which easily
			// exceeds 100 files. Tighten if the workload doesn't need it.
			maxFilesWritten: 500
			maxSubprocesses: 16
			maxCpuSeconds:   1800
			maxMemoryMib:    2048
		}
		degradedFallback: "accept-degraded-with-audit"
	}

	authorizationPolicies: "default": {
		name:         "default"
		lifecycle:    "ga"
		owner:        "me"
		agentVisible: false
		// Personal-use defaults. The sandbox's protectedPaths +
		// blastRadius + provenance scan provide the safety floor.
		// secret stays "deny" — the autonomous session must
		// request an explicit grant before reading any declared secret,
		// even on a permissive project.
		defaults: {
			skills:      "permit"
			subAgents:   "permit"
			readTools:   "permit"
			network:     "permit"
			secret:      "deny"
			destructive: "permit"
		}
		grants: []
		brokerMode: "audit-and-deny"
	}

	provenancePolicies: "default": {
		lifecycle:    "ga"
		owner:        "me"
		agentVisible: false
		egressScan: {
			secretLeak: true
			piiDetect:  true
			mcpIngress: false
		}
		quarantineUntrusted: true
		compositionRule:     "any-untrusted-poisons-output"
	}

	// L3 tools + sagas are provisioned via `harness tools add` / `harness saga
	// add` into the composed tools/*.cue and sagas/*.cue component files — not
	// hand-edited here. (Gated on depth: enable with `harness levels set L3`.)

	// --- Dynamic workflows (Claude Code, research preview) ------------------
	// 'harness init' staged two bundled workflows under workflows/ (INERT).
	// To ACTIVATE: uncomment the three blocks below and run 'harness apply'.
	// The scripts compile to .claude/workflows/<name>.js and run as /<name>.
	// Govern with workflowPolicy.enabled (false -> settings.json
	// "disableWorkflows": true) or CLAUDE_CODE_DISABLE_WORKFLOWS=1. See
	// docs/recipes/dynamic-workflows.md.
	//
	// featureFlags: standard_l4_dynamic_workflows: "on"
	// workflowPolicy: enabled: true
	// workflows: {
	// 	"codebase-audit": {
	// 		name:        "codebase-audit"
	// 		owner:       "me"
	// 		description: "Fan-out correctness + security + performance sweep, adversarially verified."
	// 		bodyRef:     "workflows/codebase-audit/codebase-audit.js"
	// 		scope:       "project"
	// 	}
	// 	"deep-research": {
	// 		name:        "deep-research"
	// 		owner:       "me"
	// 		description: "Multi-source, cross-checked research (args.question)."
	// 		bodyRef:     "workflows/deep-research/deep-research.js"
	// 		scope:       "project"
	// 	}
	// }
}
