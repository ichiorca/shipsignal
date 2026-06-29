// L3 alignment (operator-chosen): native-named #Tool so the build agent's real
// `Read` calls are governed/visible under L3 mediation. readClass-only — NO
// cacheClass, so there is ZERO read-after-write staleness risk. Mediate-only:
// the vendor executes Read; the harness only mediates. L3 firing on this build
// comes from the write-side idempotency on Write/Edit/MultiEdit.
package main

import schema "github.com/agent-harness/harness/schema"

harness: schema.#Harness & {
	tools: "Read": schema.#Tool & {
		name:             "Read"
		owner:            "me"
		description:      "Vendor Read tool — harness-mediated for L3 (read-through cache)."
		outputProvenance: "workspace-internal"
		readClass:        true
		impl: {kind: "builtin", name: "vendor-native"}
	}
}
