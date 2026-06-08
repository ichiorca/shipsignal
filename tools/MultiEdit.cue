// Aggressive L3 alignment (operator-chosen): native-named #Tool so the agent's
// `MultiEdit` calls get L3 idempotency mediation. Mediate-only. ⚠️ a MultiEdit
// reproducing a previously-written exact content is silently short-passed;
// accepted to verify L3 firing on this build.
package main

import schema "github.com/agent-harness/harness/schema"

harness: schema.#Harness & {
	tools: "MultiEdit": schema.#Tool & {
		name:             "MultiEdit"
		owner:            "me"
		description:      "Vendor MultiEdit tool — harness-mediated for L3 (idempotency)."
		outputProvenance: "workspace-internal"
		writeClass:       true
		impl: {kind: "builtin", name: "vendor-native"}
	}
}
