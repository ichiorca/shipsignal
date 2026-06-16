// /learning — the cross-run self-learning view, reskinned under the shared PageHeader so it reads
// the same as hindsight-guild's Learning route. It is the canonical home for the learning trend
// (reviewer rewriting + feature rejection falling as promoted skills compound), presented in the
// "Signals & Trends" section. Server Component: reads Aurora server-side (no secret or DB handle
// reaches the client) and renders the accessible LearningTrends view. P6 (WCAG 2.2 AA): one
// <main> landmark; PageHeader's title is the page <h1>; data lives in captioned tables.

import { listRunTrendPoints, listSkillPromotions } from '@/app/lib/db/learningTrends.ts';
import { LearningTrends } from '@/app/components/LearningTrends.ts';
import { BarChart } from '@/app/components/BarChart.ts';
import { PageHeader } from '@/app/components/PageHeader.ts';

// Always reflect the latest evals/promotions; not statically cacheable.
export const dynamic = 'force-dynamic';

export default async function LearningPage() {
  const [points, promotions] = await Promise.all([
    listRunTrendPoints(),
    listSkillPromotions(),
  ]);

  const editPoints = points.filter(
    (p): p is typeof p & { edit_distance: number } => p.edit_distance !== null,
  );

  return (
    <main id="main">
      <PageHeader
        eyebrow="Signals & Trends"
        title="Self-Learning"
        description="How the system improves: reviewer edits and rejections fall as skills compound."
      />
      <LearningTrends points={points} promotions={promotions} />
      {editPoints.length > 0 ? (
        <section aria-labelledby="edit-chart-heading">
          <h2 id="edit-chart-heading">Reviewer rewriting per run</h2>
          <p>
            How much reviewers rewrote generated content, run by run — this should fall as promoted
            skills compound. Select a run to inspect it.
          </p>
          <BarChart
            caption="Edit distance by run (oldest first)"
            labelHeader="Run"
            valueHeader="Edit distance"
            data={editPoints.map((p) => ({
              label: `${p.release_run_id.slice(0, 8)}…`,
              value: p.edit_distance,
              href: `/releases/${p.release_run_id}`,
              title: p.release_run_id,
            }))}
            formatValue={(ratio) => `${(ratio * 100).toFixed(1)}%`}
          />
        </section>
      ) : null}
    </main>
  );
}
