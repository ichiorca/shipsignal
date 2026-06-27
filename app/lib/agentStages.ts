// Canonical roster of the pipeline "agents" — the LangGraph graphs/nodes that turn a release into
// launch content (accurate to the four graphs in worker/src/release_worker plus the eval stage).
// One source of truth for the stage id/name/role/description so the Agents page (the rich roster),
// the agent→capability editor, and the /api/settings/agents validation all agree on the closed set
// of agent ids. Pure data + a type guard; no client/secret concerns.
//
// Only `content-generation` produces artifact-type capabilities (it owns content_nodes._ARTIFACT_
// SPECS); the other stages emit pipeline outputs — evidence, scores, the demo video, skill
// candidates — not artifact types, so they have no rows in agent_capabilities (migration 0035).
// KEEP the content-generation id IN SYNC with content_nodes.CONTENT_GENERATION_AGENT_ID.

export interface AgentStage {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly graph: string;
  /** What this stage does, in order. */
  readonly does: readonly string[];
  /** The gate (or lack of one) this stage feeds. */
  readonly gate: string;
  /** True for the stage(s) that produce artifact-type capabilities (editable on the Agents page). */
  readonly producesArtifacts: boolean;
  readonly link?: { readonly href: string; readonly label: string };
}

/** The agent whose artifact-type allowlist the worker gates generation by. KEEP IN SYNC with
 *  content_nodes.CONTENT_GENERATION_AGENT_ID. */
export const CONTENT_GENERATION_AGENT_ID = 'content-generation';

export const AGENT_STAGES: readonly AgentStage[] = [
  {
    id: 'release-intelligence',
    name: 'Release Intelligence',
    role: 'Evidence → feature manifest',
    graph: 'graph.py (release-intelligence graph)',
    does: [
      'Collects release evidence from GitHub (diffs, PRs, issues, docs) and redacts it before persist.',
      'Runs deterministic signal extraction, then clusters and scores the signals into candidate features.',
      'Persists the feature manifest and halts for human review.',
    ],
    gate: 'Feeds Gate #1 — the feature manifest is human-approved before any content is generated.',
    producesArtifacts: false,
    link: { href: '/', label: 'Review launches' },
  },
  {
    id: CONTENT_GENERATION_AGENT_ID,
    name: 'Content Generation',
    role: 'Approved features → drafts + provenance',
    graph: 'content_graph.py (content-generation graph)',
    does: [
      'Loads the approved features and snapshots the active repo skills that will ground generation.',
      'Generates the selected artifacts in parallel (blog/changelog, one-pager, social, demo script, audio digest).',
      'Extracts each claim, links it to concrete evidence, then runs deterministic policy checks and Bedrock Guardrails.',
      'Persists the reviewable artifacts and halts for human review.',
    ],
    gate: 'Feeds Gate #2 — artifacts are human-approved (a blocking check marks an artifact "blocked") before publish.',
    producesArtifacts: true,
    link: { href: '/distribute', label: 'Review artifacts' },
  },
  {
    id: 'eval',
    name: 'Eval',
    role: 'Quality scoring of generated artifacts',
    graph: 'eval_orchestration.py / eval_rubric.py',
    does: [
      'Scores generated artifacts against the rubric with an LLM-as-judge, dimension by dimension.',
      'Applies regression gates so quality and cost/latency stay within budget across launches.',
    ],
    gate: 'Advises Gate #2 — the scores and rubric breakdown inform the reviewer; they do not auto-approve.',
    producesArtifacts: false,
    link: { href: '/telemetry', label: 'See quality signals' },
  },
  {
    id: 'media-generation',
    name: 'Media Generation',
    role: 'Approved demo script → demo video',
    graph: 'media_graph.py (media graph)',
    does: [
      'Validates the click-path JSON, then drives a Playwright capture of the demo.',
      'Stores the raw recording, generates ElevenLabs narration from the approved script, and assembles the video with ffmpeg.',
      'Stores the finished media in S3 and records the media asset.',
    ],
    gate: 'No human gate — it runs only on an already Gate #2-approved demo script; safety is structural (schema-validated click-path, materialized-audio guard).',
    producesArtifacts: false,
    link: { href: '/', label: 'Open a launch' },
  },
  {
    id: 'skill-learning',
    name: 'Skill Learning',
    role: 'Reviewer signals → skill revision candidate',
    graph: 'skill_learning_graph.py (skill-learning graph)',
    does: [
      'Collects learning signals from reviewer edits and rejections across launches.',
      'Clusters the edit and rejection patterns and selects the impacted skills.',
      'Drafts a candidate revision to a repo SKILL.md and halts for human review.',
    ],
    gate: 'Feeds Gate #3 — a human must approve before any repo SKILL.md is overwritten and its commit SHA recorded.',
    producesArtifacts: false,
    link: { href: '/skills', label: 'Review skill candidates' },
  },
];

const AGENT_IDS: ReadonlySet<string> = new Set(AGENT_STAGES.map((s) => s.id));

export function isAgentId(value: string): boolean {
  return AGENT_IDS.has(value);
}

/** The agent ids that produce artifact-type capabilities — the agents the editor can map. */
export function agentLabel(agentId: string): string {
  return AGENT_STAGES.find((s) => s.id === agentId)?.name ?? agentId;
}
