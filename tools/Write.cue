// Aggressive L3 alignment (operator-chosen): native-named #Tool so the agent's
// `Write` calls get L3 idempotency mediation. Mediate-only. ⚠️ a legitimate
// re-write to a previously-written exact content is silently short-passed;
// accepted to verify L3 firing on this build.
package main

import schema "github.com/agent-harness/harness/schema"

harness: schema.#Harness & {
	tools: "Write": schema.#Tool & {
		name:             "Write"
		owner:            "me"
		description:      "Vendor Write tool — harness-mediated for L3 (idempotency)."
		outputProvenance: "workspace-internal"
		writeClass:       true
		impl: {kind: "builtin", name: "vendor-native"}
	}
}
