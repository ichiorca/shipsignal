// T5 (spec 013) — per-run Eval dashboard screen (PRD §17.1 metrics, §13.1 Eval dashboard).
// Server Component: it reads Aurora server-side (no secret or DB handle reaches the client) and
// renders the accessible EvalDashboard. P6 (WCAG 2.2 AA): one <main> landmark + heading; the
// metrics are a semantic table, keyboard-operable links lead in and out. constitution §2/§5:
// only run-scoped metric scores + aggregate counts are read here — never a prompt, evidence,
// artifact body, or PII. The AC's three headline metrics (unsupported-claim rate, edit distance,
// approval latency) are always present in the table (METRIC_ORDER), scored "n/a" until computed.

import { notFound } from 'next/navigation';
import { getReleaseRun } from '@/app/lib/db/releaseRuns.ts';
import { getRunEvalSummary } from '@/app/lib/db/evalRuns.ts';
import { EvalDashboard } from '@/app/components/EvalDashboard.ts';

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

  const summary = await getRunEvalSummary(run.id);

  return (
    <main id="main">
      <p>
        <a href={`/releases/${run.id}`}>← Back to release run</a>
      </p>
      <h1>Evaluation</h1>
      <p>
        {run.repo} · {run.base_ref}…{run.head_ref}
      </p>
      <EvalDashboard summary={summary} />
    </main>
  );
}
