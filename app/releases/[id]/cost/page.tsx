// T5 (spec 011) — per-run cost/latency view (PRD §6 cost/latency bar, §17 cost metrics, §13.1
// eval/observability surface). Server Component: it reads Aurora server-side (no secret or DB
// handle reaches the client) and renders the accessible CostBreakdown table. P6 (WCAG 2.2 AA):
// one <main> landmark + heading; the breakdown is a semantic table, keyboard-operable links lead
// in and out. constitution §2/§5: only run-scoped metrics + provenance are read here — node,
// model, tier, tokens, latency, USD estimate — never a prompt, evidence, or model output.
//
// T4/T5 (spec 021) — the outcome side: the engagement CSV upload panel and the cost-vs-
// outcome (ROI) table, turning this page from "what we spent" into "what we got". Only
// aggregate engagement counts are read; missing engagement renders "not yet reported".

import { notFound } from 'next/navigation';
import { getReleaseRun } from '@/app/lib/db/releaseRuns.ts';
import { getRunCostBreakdown } from '@/app/lib/db/modelCallTelemetry.ts';
import { listArtifactRefsForRun } from '@/app/lib/db/artifacts.ts';
import { getRunEngagementByType } from '@/app/lib/db/engagementMetrics.ts';
import { buildRoiSummary } from '@/app/lib/engagement.ts';
import { aggregateCostByNode } from '@/app/lib/cost.ts';
import { CostBreakdown } from '@/app/components/CostBreakdown.ts';
import { BarChart } from '@/app/components/BarChart.ts';
import { EngagementCsvUpload } from '@/app/components/EngagementCsvUpload.ts';
import { RoiBreakdown } from '@/app/components/RoiBreakdown.ts';

// Always reflect the latest telemetry for the run.
export const dynamic = 'force-dynamic';

interface CostPageProps {
  readonly params: Promise<{ id: string }>;
}

export default async function RunCostPage({ params }: CostPageProps) {
  const { id } = await params;
  const run = await getReleaseRun(id);
  if (run === null) {
    notFound();
  }

  const [breakdown, artifacts, engagement] = await Promise.all([
    getRunCostBreakdown(run.id),
    listArtifactRefsForRun(run.id),
    getRunEngagementByType(run.id),
  ]);
  const { totals } = breakdown;
  const roi = buildRoiSummary(
    [...new Set(artifacts.map((a) => a.artifact_type))],
    engagement,
    breakdown,
  );

  return (
    <main id="main">
      <nav aria-label="Breadcrumb">
        <a href="/">All launches</a>
        {' › '}
        <a href={`/releases/${run.id}`}>Launch</a>
        {' › '}
        <span aria-current="page">Model cost &amp; latency</span>
      </nav>
      <h1>Model cost &amp; latency</h1>
      <p>
        {run.repo} · {run.base_ref}…{run.head_ref}
      </p>
      <p>
        {totals.calls === 0
          ? 'No model calls have been recorded for this run yet.'
          : `${totals.calls} model call${totals.calls === 1 ? '' : 's'} · ` +
            `estimated $${totals.cost_usd.toFixed(4)} · ` +
            `${(totals.input_tokens + totals.output_tokens).toLocaleString('en-US')} tokens`}
      </p>
      {breakdown.byNode.length > 0 ? (
        <section aria-labelledby="spend-chart-heading">
          <h2 id="spend-chart-heading">Where the spend goes</h2>
          <BarChart
            caption="Estimated cost by node (most expensive first)"
            labelHeader="Node"
            valueHeader="Est. cost"
            data={aggregateCostByNode(breakdown.byNode).map((n) => ({
              label: n.node_name,
              value: n.cost_usd,
            }))}
            formatValue={(usd) => `$${usd.toFixed(4)}`}
          />
        </section>
      ) : null}

      <CostBreakdown breakdown={breakdown} />

      <section aria-labelledby="roi-heading">
        <h2 id="roi-heading">Cost vs outcome</h2>
        <RoiBreakdown summary={roi} />
      </section>

      <EngagementCsvUpload releaseRunId={run.id} artifacts={artifacts} />
    </main>
  );
}
