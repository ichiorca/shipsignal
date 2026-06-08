// Aggressive L3 alignment (operator-chosen): native-named #Tool so the agent's
// `Edit` calls get L3 idempotency mediation. Mediate-only. ⚠️ an Edit that
// reproduces a previously-written exact content is silently short-passed;
// accepted to verify L3 firing on this build.
package main

import schema "github.com/agent-harness/harness/schema"

harness: schema.#Harness & {
	tools: "Edit": schema.#Tool & {
		name:             "Edit"
		owner:            "me"
		description:      "Vendor Edit tool — harness-mediated for L3 (idempotency)."
		outputProvenance: "workspace-internal"
		writeClass:       true
		impl: {kind: "builtin", name: "vendor-native"}
	}
}
