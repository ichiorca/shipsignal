// T6 (spec 001) — release feed (run list), the dashboard entry point (PRD §13.1).
// Server Component: it reads from Aurora server-side and renders the run list; no
// secret or DB handle ever reaches the client. P6 (WCAG 2.2 AA): one <main> landmark
// with a heading, and the semantic RunListTable.

import { listReleaseRuns } from '@/app/lib/db/releaseRuns.ts';
import { getHeroStats } from '@/app/lib/db/heroStats.ts';
import { buildHeroStats } from '@/app/lib/heroStats.ts';
import { PageHeader } from '@/app/components/PageHeader.ts';
import { RunFeed } from '@/app/components/RunFeed.ts';
import { ReviewQueue } from '@/app/components/ReviewQueue.ts';
import { StatusLegend } from '@/app/components/StatusLegend.ts';
import { HeroStats } from '@/app/components/HeroStats.ts';

// Always reflect the latest runs; this feed is not statically cacheable.
export const dynamic = 'force-dynamic';

export default async function FounderDashboardPage() {
  // One page, two reads: the run feed and the cross-run hero aggregates.
  const [runs, heroData] = await Promise.all([listReleaseRuns(), getHeroStats()]);
  return (
    <main id="main">
      <PageHeader
        eyebrow="Decisions"
        title="Founder Dashboard"
        description="ROI, impact, and the launches that need your call. Drafting and the full approval queue live in their own tabs."
      />
      {/* The cross-launch value story — lead with ROI on the dashboard. */}
      <HeroStats stats={buildHeroStats(heroData)} />
      {/* What needs me — launches halted at an approval, each linking straight to its gate. */}
      <ReviewQueue runs={runs} />
      <div data-list-header>
        <p>{runs.length === 1 ? '1 launch' : `${runs.length} launches`}</p>
        <StatusLegend />
      </div>
      <RunFeed runs={runs} />
    </main>
  );
}
