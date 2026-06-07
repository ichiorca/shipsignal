package claude_code

import schema "github.com/agent-harness/harness/schema"

// Adapter contract for Anthropic's Claude Code CLI. See TECH-SPEC §5.3.
// Behavioural rules (refusing --dangerously-skip-permissions, secret-broker
// injection, cost-telemetry tailing) live in the adapter binary under
// internal/adapters/claudecode/, NOT in this IR contract.
contract: schema.#AdapterContract & {
	name:         "claude-code"
	lifecycle:    "beta"
	owner:        "platform"
	agentVisible: false
	target: {
		vendor:     "Anthropic"
		product:    "claude-code"
		minVersion: "2.0.0"
	}
	compiles: [
		{root: "Harness",             to: "~/.claude/settings.json"},
		{root: "Skill",               to: "~/.claude/skills/<name>/SKILL.md"},
		{root: "Agent",               to: "~/.claude/agents/<name>.md"},
		{root: "Workflow",            to: "~/.claude/workflows/<name>.js"},
		{root: "Hook",                to: "~/.claude/settings.json#hooks"},
		{root: "Tool",                to: "~/.claude/settings.json#permissions"},
		{root: "AuthorizationPolicy", to: "internal: pre-tool hook resolution"},
		{root: "Sandbox",             to: "internal: hook-side enforcement"},
		{root: "ProvenancePolicy",    to: "internal: ingress/egress audit"},
	]
	degradations: []
	outputPaths: [
		"~/.claude/settings.json",
		"~/.claude/skills/**",
		"~/.claude/agents/**",
		"~/.claude/workflows/**",
		"~/.claude-plugin/plugin.json",
	]
}
