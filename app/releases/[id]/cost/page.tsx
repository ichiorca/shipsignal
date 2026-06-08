// T5 (spec 011) — per-run cost/latency view (PRD §6 cost/latency bar, §17 cost metrics, §13.1
// eval/observability surface). Server Component: it reads Aurora server-side (no secret or DB
// handle reaches the client) and renders the accessible CostBreakdown table. P6 (WCAG 2.2 AA):
// one <main> landmark + heading; the breakdown is a semantic table, keyboard-operable links lead
// in and out. constitution §2/§5: only run-scoped metrics + provenance are read here — node,
// model, tier, tokens, latency, USD estimate — never a prompt, evidence, or model output.

import { notFound } from 'next/navigation';
import { getReleaseRun } from '@/app/lib/db/releaseRuns.ts';
import { getRunCostBreakdown } from '@/app/lib/db/modelCallTelemetry.ts';
import { CostBreakdown } from '@/app/components/CostBreakdown.ts';

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

  const breakdown = await getRunCostBreakdown(run.id);
  const { totals } = breakdown;

  return (
    <main id="main">
      <p>
        <a href={`/releases/${run.id}`}>← Back to release run</a>
      </p>
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
      <CostBreakdown breakdown={breakdown} />
    </main>
  );
}
