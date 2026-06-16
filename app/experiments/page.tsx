// /experiments — "Experiments" in the reskinned "Signals & Trends" section, mirroring
// hindsight-guild's Experiments route. ShipSignal has NO experiments data model yet, so this is an
// honest, well-styled empty state: it explains what Experiments will hold (A/B tests of skill
// versions, send-time experiments, prompt/model-tier experiments) and is clearly marked as
// not-yet-available — it invents no fake experiment rows. The "Coming soon" cards mirror the
// SectionHub "soon" pattern (non-interactive, with a text marker — colour is never the sole
// signal). Server Component (no data reads). P6 (WCAG 2.2 AA): one <main> landmark; PageHeader
// title is the page <h1>; roadmap items are a semantic list with a text "Coming soon" marker.

import { PageHeader } from '@/app/components/PageHeader.ts';

export const dynamic = 'force-dynamic';

interface PlannedExperiment {
  readonly title: string;
  readonly description: string;
}

const PLANNED: readonly PlannedExperiment[] = [
  {
    title: 'Skill-version A/B tests',
    description:
      'Split generation between a promoted skill and its predecessor, then compare reviewer edit distance and rubric scores to confirm a promotion actually improved output.',
  },
  {
    title: 'Send-time experiments',
    description:
      'Vary when an approved artifact is distributed and attribute downstream engagement back to the send window.',
  },
  {
    title: 'Prompt & model-tier experiments',
    description:
      'Trial alternate prompts or Bedrock model tiers for a generation node and weigh quality against the token/latency budget before adopting a change.',
  },
];

export default function ExperimentsPage() {
  return (
    <main id="main">
      <PageHeader eyebrow="Signals & Trends" title="Experiments" description="Hypotheses in flight." />

      <section aria-labelledby="experiments-status-heading">
        <h2 id="experiments-status-heading">Not yet available</h2>
        <p>
          ShipSignal does not run experiments yet — there is no experiment data to show, and this
          page deliberately invents none. When the experiment loop ships, each entry will carry a
          falsifiable hypothesis and a pre-committed decision rule, decided from rubric telemetry
          and engagement outcomes rather than guesswork.
        </p>
      </section>

      <section aria-labelledby="experiments-roadmap-heading">
        <h2 id="experiments-roadmap-heading">What Experiments will hold</h2>
        <ul data-hub-cards="">
          {PLANNED.map((item) => (
            <li key={item.title} data-hub-card="" data-soon="">
              <div>
                <h3>{item.title}</h3>
                <p>{item.description}</p>
                <p data-card-soon="">Coming soon</p>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
