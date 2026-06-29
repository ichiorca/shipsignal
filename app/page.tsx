// T6 (spec 001) — release feed (run list), the dashboard entry point (PRD §13.1).
// Server Component: it reads from Aurora server-side and renders the run list; no
// secret or DB handle ever reaches the client. P6 (WCAG 2.2 AA): one <main> landmark
// with a heading, and the semantic RunListTable.

import { listReleaseRuns } from '@/app/lib/db/releaseRuns.ts';
import { getHeroStats } from '@/app/lib/db/heroStats.ts';
import { getFunnelCounts } from '@/app/lib/db/funnelStats.ts';
import { buildHeroStats } from '@/app/lib/heroStats.ts';
import { hasSyntheticRun } from '@/app/lib/syntheticRun.ts';
import { isAwaitingReview } from '@/app/lib/runProgress.ts';
import { PageHeader } from '@/app/components/PageHeader.ts';
import { ReviewQueue } from '@/app/components/ReviewQueue.ts';
import { HeroStats } from '@/app/components/HeroStats.ts';
import { ConversionFunnel } from '@/app/components/ConversionFunnel.ts';
import { FirstRunHero } from '@/app/components/FirstRunHero.ts';
import { SampleDataNotice } from '@/app/components/SampleDataNotice.ts';

// Always reflect the latest runs; this feed is not statically cacheable.
export const dynamic = 'force-dynamic';

export default async function FounderDashboardPage() {
  // One page, three reads: the run feed, the cross-run hero aggregates, and the ROI funnel.
  const [runs, heroData, funnelCounts] = await Promise.all([
    listReleaseRuns(),
    getHeroStats(),
    getFunnelCounts(),
  ]);

  // R9 (time-to-wow): an empty deployment leads with the sell-and-seed hero instead of four
  // "—" stats over an empty table — one click to a fully-populated sample run.
  if (runs.length === 0) {
    return (
      <main id="main">
        <PageHeader
          eyebrow="Overview"
          title="Founder Dashboard"
          description="ROI, impact, and the launches that need your call."
        />
        <FirstRunHero />
      </main>
    );
  }

  // R4 — the dashboard is the NARRATIVE surface (ROI + what needs you now), not a second copy of
  // the queue. The exhaustive, searchable launches feed lives only on the Review Queue, reached
  // via the CTA below — so the two pages have distinct jobs instead of echoing each other.
  const awaitingCount = runs.filter(isAwaitingReview).length;
  return (
    <main id="main">
      <PageHeader
        eyebrow="Overview"
        title="Founder Dashboard"
        description="ROI, impact, and the launches that need your call. The full launch feed lives in the Review Queue."
      />
      {/* Honest signal when the view includes demo-seeded data (UX review R9). */}
      <SampleDataNotice show={hasSyntheticRun(runs)} />
      {/* R5 — name the value proposition in one sentence so the numbers below PROVE a claim
          rather than standing alone (the provenance story is the product's wedge). */}
      <p data-hero-lede>
        From a git tag to publish-ready content in minutes — and every claim is traceable to the
        diff that earned it.
      </p>
      {/* The cross-launch value story — lead with ROI on the dashboard. */}
      <HeroStats stats={buildHeroStats(heroData)} />
      {/* R10 — the ROI loop as a funnel: generated → approved → published → engaged. */}
      <ConversionFunnel counts={funnelCounts} />
      {/* What needs me — launches halted at an approval, each linking straight to its gate. */}
      <ReviewQueue runs={runs} />
      {/* Hand off to the working surfaces rather than re-listing every run here (R4). */}
      <section aria-labelledby="dashboard-next-heading" data-dashboard-actions>
        <h2 id="dashboard-next-heading">Keep going</h2>
        <div data-dashboard-cta-row>
          <a href="/queue" data-cta-primary>
            Open the Review Queue
            {awaitingCount > 0 ? ` (${awaitingCount} awaiting)` : ''} →
          </a>
          <a href="/draft" data-cta-secondary>
            Start a new launch →
          </a>
        </div>
      </section>
    </main>
  );
}
