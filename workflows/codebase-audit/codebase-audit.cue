// Reference #Workflow declaration for the bundled `codebase-audit` workflow.
//
// The harness does NOT auto-compose workflows/**.cue — this file is a
// copy-paste-ready snippet, not an active declaration. To activate: paste
// this block into harness.cue under `workflows:` (or uncomment the block
// `harness init` scaffolds) and set
// featureFlags.standard_l4_dynamic_workflows: "on". See
// docs/recipes/dynamic-workflows.md.
package main

harness: workflows: "codebase-audit": {
	name:        "codebase-audit"
	owner:       "harness-bundled"
	lifecycle:   "ga"
	description: "Fan-out correctness + security + performance sweep across the repo, adversarially verified."
	bodyRef:     "workflows/codebase-audit/codebase-audit.js"
	scope:       "project"
}
