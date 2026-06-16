// Reskin (peer parity with hindsight-guild/web Agents.tsx) — the "Agents" view. ShipSignal has no
// human agent roster: its "agents" are the LangGraph graphs/nodes that turn a release into launch
// content. This page presents an honest, static roster of those pipeline stages, accurate to the
// four graphs in worker/src/release_worker (graph.py, content_graph.py, media_graph.py,
// skill_learning_graph.py) plus the eval stage (eval_orchestration / eval_rubric). It is framed as
// the automated team, not fake humans. Server Component, no data reads. P6 (WCAG 2.2 AA): one
// <main> landmark, sections render as cards (global CSS), each starts with an <h2>; the roster is a
// semantic list with real links to each stage's existing surface.

import { PageHeader } from '@/app/components/PageHeader.ts';

export const dynamic = 'force-dynamic';

interface AgentStage {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly graph: string;
  /** What this stage does, in order. */
  readonly does: readonly string[];
  /** The gate (or lack of one) this stage feeds. */
  readonly gate: string;
  readonly link?: { readonly href: string; readonly label: string };
}

const STAGES: readonly AgentStage[] = [
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
    link: { href: '/', label: 'Review launches' },
  },
  {
    id: 'content-generation',
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
    link: { href: '/skills', label: 'Review skill candidates' },
  },
];

export default function AgentsPage() {
  return (
    <main id="main">
      <PageHeader
        eyebrow="Skill library"
        title="Agents"
        description="The team that turns a release into launch content."
      />

      <section aria-labelledby="roster-intro-heading">
        <h2 id="roster-intro-heading">The automated team</h2>
        <p>
          ShipSignal has no human agent roster. Its &ldquo;agents&rdquo; are the LangGraph graphs
          and nodes that do the work — each a stage in the pipeline that turns a release into
          approved launch content. Each stage below describes its role, what it does, and the
          human approval gate it feeds.
        </p>
      </section>

      {STAGES.map((stage) => (
        <section key={stage.id} aria-labelledby={`${stage.id}-heading`}>
          <h2 id={`${stage.id}-heading`}>{stage.name}</h2>
          <p>
            <strong>{stage.role}</strong>
          </p>
          <p>
            Graph: <code>{stage.graph}</code>
          </p>
          <ul>
            {stage.does.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p>{stage.gate}</p>
          {stage.link !== undefined ? (
            <p>
              <a href={stage.link.href}>{stage.link.label}</a>
            </p>
          ) : null}
        </section>
      ))}
    </main>
  );
}
