package schema

import "github.com/agent-harness/harness/schema/shared"

// #SpecPack — versioned conformance pack bundling exit criteria,
// tool requirements, and skill version pins for a named external
// protocol (e.g. ACP 3.2, UCP 1.0, AP2, A2A).
//
// Publishing side: a spec-pack author (typically a protocol
// consortium or SDK vendor, e.g. ACME's `acme-spec-pack` package)
// ships a versioned bundle of CUE declarations.
//
// Consuming side: a merchant project loads the pack via
// `harness spec-pack adopt <path>` which drops the .cue file under
// `.harness/specs/` and merges it into the project's `harness.cue`
// `specPacks` map. Feature briefs then reference exit criteria by
// pack id + criterion id (e.g. `specPacks.acp.exitCriteria.
// checkout-webhook-asymmetry`).
//
// History: ACME's harness-integration plan (Q5) asked for this as
// an additive top-level field so spec packs don't have to live
// under #Eval / #Tool shoehorned shapes.
//
// Non-breaking: existing harness installs that don't declare any
// `specPacks` are unaffected.
#SpecPack: {
	// Protocol identity — short slug.
	// Examples: "acp", "ucp", "ap2", "a2a".
	protocol: string

	// Pack version — separate from the protocol version it implements
	// (a v0.2 pack might implement ACP 3.2).
	version: shared.#SemVer

	// Protocol version this pack targets — the version of the
	// EXTERNAL protocol, not the pack itself. Separated from
	// `version` so a pack author can ship multiple patch releases
	// (v0.2.1, v0.2.2) all targeting ACP 3.2.
	protocolVersion: shared.#SemVer

	// Owner / contact for the pack (typically the publishing org or
	// consortium — not the merchant adopting the pack).
	owner: string

	// Optional spec URL — operator-readable docs the brief surfaces.
	specUrl?: string

	// Optional descriptive blob.
	description?: string

	// exit criteria — named conformance gates that merchant features
	// can reference by id. The pack provides the criterion; the
	// merchant references it by id in their feature brief.
	exitCriteria: [string]: #SpecExitCriterion

	// tool requirements — minimum versions / capabilities the pack
	// requires from tools used in its conformance flows. The harness
	// surfaces violations as #SpecPack-attributed exit-criteria fails.
	toolRequirements?: [string]: #SpecToolRequirement

	// skill version pins — the pack can mandate specific skill
	// versions for compliance (e.g. checkout-webhook-handler@2.1).
	// Maps skill name → required version constraint (semver range
	// allowed). The runtime refuses to dispatch to a skill that
	// doesn't satisfy the pin while the pack is active.
	skillVersionPins?: [string]: string
}

// #SpecExitCriterion — one named conformance gate inside a #SpecPack.
//
// Referenced from feature briefs by id. The harness's `spec-kit
// review` command surfaces criteria the brief references but the
// pass didn't satisfy (severity=required → fail; severity=recommended
// → warn; severity=advisory → informational only).
#SpecExitCriterion: {
	// Human-readable name (shown in briefs + review output).
	name: string

	// Brief description (1-2 sentences) explaining what the
	// criterion guarantees. Surfaced verbatim in feature briefs.
	description: string

	// Severity controls how `harness spec-kit review` treats a
	// missed criterion:
	//   required    → review fails; PR blocked
	//   recommended → review warns; reviewer judgment call
	//   advisory    → informational only; never blocks
	severity: *"required" | "recommended" | "advisory"

	// Optional check command — best-effort verification. The
	// runtime executes this from the workspace root after a feature
	// pass when --run-checks is set; non-zero exit means the
	// criterion is unmet.
	checkCommand?: string

	// Optional fixture id — when set, the harness can run this
	// fixture during a feature pass and treat its outcome as
	// gating. Resolves against the project's `fixtureTemplates`
	// map.
	fixtureId?: string
}

// #SpecToolRequirement — minimum version / capability assertions
// the pack places on a tool used in its conformance flows.
#SpecToolRequirement: {
	// minVersion — semver lower bound the tool must satisfy. The
	// harness compares against the tool's declared `lifecycleVersion`.
	minVersion?: shared.#SemVer

	// requiredCapabilities — every entry must appear in the tool's
	// declared capability set. Missing capabilities surface as an
	// adoption-time `spec-pack adopt` error so misconfigured
	// merchant catalogs fail fast.
	requiredCapabilities?: [...string]
}
