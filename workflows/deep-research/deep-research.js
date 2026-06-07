// harness bundled workflow — deep-research
// Maintainer-authored example against the documented workflow runtime API.
// Validate / regenerate in your project via `ultracode` then `/workflows` → s.
// Staged INERT by `harness init` (featureFlags.standard_l4_dynamic_workflows
// stays off until you opt in). Pass the question via `args.question`.

export const meta = {
  name: 'deep-research',
  description: 'Multi-source, cross-checked research on a question (args.question): fan out search angles, deep-read each, then synthesize a cited answer.',
  phases: [
    { title: 'Search', detail: 'fan out distinct research angles' },
    { title: 'Read', detail: 'deep-read each angle' },
    { title: 'Synthesize', detail: 'cross-check + write the answer' },
  ],
}

const question =
  (args && args.question) ||
  'No question supplied — pass one via args.question (e.g. /deep-research {"question":"..."}).'

const ANGLES = [
  'official docs / primary sources',
  'recent changes / changelogs / release notes',
  'known pitfalls / failure reports / issues',
  'comparisons / alternatives / trade-offs',
]

phase('Search')
const hits = await parallel(ANGLES.map(a => () =>
  agent(
    `Research the question "${question}" focusing ONLY on: ${a}. Use web search/fetch to find CURRENT sources. Return the 3-5 best sources, each with a one-line takeaway and its URL.`,
    { label: `search:${a}`, phase: 'Search' },
  ),
))

phase('Read')
const reads = await parallel(hits.filter(Boolean).map((h, i) => () =>
  agent(
    `Deep-read the sources below and extract the load-bearing facts, each with its citation URL. Note anything that contradicts another source.\n\n${h}`,
    { label: `read:${i}`, phase: 'Read' },
  ),
))

phase('Synthesize')
const synthesis = await agent(
  `Synthesize a cross-checked answer to "${question}" from the findings below. Lead with the answer, then evidence. Flag any disagreements between sources and prefer primary sources. Cite URLs inline.\n\n${reads.filter(Boolean).join('\n\n---\n\n')}`,
  { label: 'synthesize' },
)

log('deep-research complete')
return { question, synthesis }
