// L3 alignment (operator-chosen): native-named #Tool so the agent's `Glob`
// calls are governed/visible under L3. readClass-only — NO cacheClass, so no
// stale-result risk. Mediate-only.
package main

import schema "github.com/agent-harness/harness/schema"

harness: schema.#Harness & {
	tools: "Glob": schema.#Tool & {
		name:             "Glob"
		owner:            "me"
		description:      "Vendor Glob tool — harness-mediated for L3 (read-through cache)."
		outputProvenance: "workspace-internal"
		readClass:        true
		impl: {kind: "builtin", name: "vendor-native"}
	}
}
