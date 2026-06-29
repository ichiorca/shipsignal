// Reference #Workflow declaration for the bundled `deep-research` workflow.
//
// The harness does NOT auto-compose workflows/**.cue — this file is a
// copy-paste-ready snippet, not an active declaration. To activate: paste
// this block into harness.cue under `workflows:` (or uncomment the block
// `harness init` scaffolds) and set
// featureFlags.standard_l4_dynamic_workflows: "on". See
// docs/recipes/dynamic-workflows.md.
package main

harness: workflows: "deep-research": {
	name:        "deep-research"
	owner:       "harness-bundled"
	lifecycle:   "ga"
	description: "Multi-source, cross-checked research on a question (args.question), synthesized with citations."
	bodyRef:     "workflows/deep-research/deep-research.js"
	scope:       "project"
	args: question: "" // the research question; pass at invoke time
}
