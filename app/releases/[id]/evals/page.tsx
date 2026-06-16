// T5 (spec 013) — per-run Eval dashboard screen (PRD §17.1 metrics, §13.1 Eval dashboard).
// Server Component: it reads Aurora server-side (no secret or DB handle reaches the client) and
// renders the accessible EvalDashboard. P6 (WCAG 2.2 AA): one <main> landmark + heading; the
// metrics are a semantic table, keyboard-operable links lead in and out. constitution §2/§5:
// only run-scoped metric scores + aggregate counts are read here — never a prompt, evidence,
// artifact body, or PII. The AC's three headline metrics (unsupported-claim rate, edit distance,
// approval latency) are always present in the table (METRIC_ORDER), scored "n/a" until computed.

import { notFound } from 'next/navigation';
import { getReleaseRun } from '@/app/lib/db/releaseRuns.ts';
import { getRunEvalSummary, getRunRubricDimensionAverages } from '@/app/lib/db/evalRuns.ts';
import { EvalDashboard } from '@/app/components/EvalDashboard.ts';
import { BarChart } from '@/app/components/BarChart.ts';
import { RUBRIC_SCORE_MAX } from '@/app/lib/rubricView.ts';

// Always reflect the latest eval results for the run.
export const dynamic = 'force-dynamic';

interface EvalPageProps {
  readonly params: Promise<{ id: string }>;
}

export default async function RunEvalPage({ params }: EvalPageProps) {
  const { id } = await params;
  const run = await getReleaseRun(id);
  if (run === null) {
    notFound();
  }

  const [summary, rubricDimensions] = await Promise.all([
    getRunEvalSummary(run.id),
    getRunRubricDimensionAverages(run.id),
  ]);
  // Only chart dimensions an artifact actually scored; if none did, the EvalDashboard's rubric
  // caption already explains there are no rubric scores yet, so we render no empty chart.
  const scoredDimensions = rubricDimensions.filter((d) => d.average !== null);

  return (
    <main id="main">
      <nav aria-label="Breadcrumb">
        <a href="/">All launches</a>
        {' › '}
        <a href={`/releases/${run.id}`}>Launch</a>
        {' › '}
        <span aria-current="page">Evaluation</span>
      </nav>
      <h1>Evaluation</h1>
      <p>
        {run.repo} · {run.base_ref}…{run.head_ref}
      </p>
      <EvalDashboard summary={summary} />
      {scoredDimensions.length > 0 ? (
        <section aria-labelledby="rubric-chart-heading">
          <h2 id="rubric-chart-heading">Rubric by dimension</h2>
          <p>
            LLM-as-judge average per dimension, 1 (poor) to {RUBRIC_SCORE_MAX} (excellent), across
            this run’s approved artifacts.
          </p>
          <BarChart
            caption={`Rubric score by dimension (out of ${RUBRIC_SCORE_MAX})`}
            labelHeader="Dimension"
            valueHeader="Avg score"
            max={RUBRIC_SCORE_MAX}
            data={scoredDimensions.map((d) => ({
              label: d.label,
              // average is non-null here (filtered above); coalesce keeps the type honest.
              value: d.average ?? 0,
            }))}
            formatValue={(score) => `${score.toFixed(2)} / ${RUBRIC_SCORE_MAX}`}
          />
        </section>
      ) : null}
    </main>
  );
}
