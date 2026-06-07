package schema

// #Secret — a named secret declaration. The agent references it via
// `{{secret:<name>}}` handles in tool inputs; the adapter's secret
// broker resolves the handle before dispatch and redacts the value
// from the L1 event log (TECH-SPEC §3.13).
//
// Tier-0 source kinds:
//   - "env":     read from `os.Getenv(source.ref)` at resolve time.
//   - "file":    read from the file at source.ref (process must have read access).
//   - "keyring": OS keychain lookup keyed on source.ref (macOS, Windows, libsecret on Linux).
//
// Higher tiers swap in Vault / AWS Secrets Manager / GCP Secret
// Manager / Azure Key Vault behind the same #Secret contract — the
// agent's `{{secret:foo}}` handle is invariant under tier swap.
#Secret: {
	name:         string
	lifecycle:    "alpha" | "beta" | *"ga" | "deprecated"
	owner:        string
	agentVisible: *false | bool
	description?: string

	// Where the broker reads the actual value.
	source: {
		kind: "env" | "file" | "keyring"
		ref:  string // env var name, absolute file path, or keyring entry name
	}

	// Optional rotation hint. Operator-facing metadata; the broker
	// doesn't enforce rotation, but `harness doctor` flags secrets
	// past their rotation deadline.
	rotateBy?: string // RFC3339 timestamp

	// allowedTools — if non-empty, only these tool names may receive
	// the resolved value at dispatch time. Empty = any tool that
	// includes a matching `{{secret:<name>}}` handle.
	allowedTools?: [...string]
}
