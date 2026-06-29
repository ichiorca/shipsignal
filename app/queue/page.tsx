// Approval Queue — the transactional inbox (reskin to mirror hindsight-guild's Queue.tsx).
// Server Component: reads the run feed from Aurora server-side and renders it; no secret or DB
// handle reaches the client. Leads with the ReviewQueue (runs halted at a human gate, each linking
// straight to its gate), then the full launches feed for context. P6 (WCAG 2.2 AA): one <main>
// landmark, the PageHeader title is the page <h1>, and each content card is a labelled <section>
// led by an <h2>.

import { listReleaseRuns } from '@/app/lib/db/releaseRuns.ts';
import { hasSyntheticRun } from '@/app/lib/syntheticRun.ts';
import { PageHeader } from '@/app/components/PageHeader.ts';
import { ReviewQueue } from '@/app/components/ReviewQueue.ts';
import { RunFeed } from '@/app/components/RunFeed.ts';
import { StatusLegend } from '@/app/components/StatusLegend.ts';
import { SampleDataNotice } from '@/app/components/SampleDataNotice.ts';

// Always reflect the latest runs; this inbox is not statically cacheable.
export const dynamic = 'force-dynamic';

export default async function ApprovalQueuePage() {
  const runs = await listReleaseRuns();
  return (
    <main id="main">
      <PageHeader
        eyebrow="Workflow"
        title="Review Queue"
        description="Launches waiting on your decision at a gate — and the full launch feed."
      />
      <SampleDataNotice show={hasSyntheticRun(runs)} />
      {/* Lead with "what needs me" — launches halted at an approval, each linking to its gate. */}
      <ReviewQueue runs={runs} />
      {/* The full launches feed for context, with search / status filter / pagination. */}
      <section aria-labelledby="all-launches-heading">
        <h2 id="all-launches-heading">All launches</h2>
        <div data-list-header>
          <p>{runs.length === 1 ? '1 launch' : `${runs.length} launches`}</p>
          <StatusLegend />
        </div>
        <RunFeed runs={runs} />
      </section>
    </main>
  );
}
