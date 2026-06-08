// T5 (spec 004) — Gate #1 feature-manifest review page (PRD §5.6, §13.1).
// Server Component: reads Aurora server-side (no secret or DB handle reaches the client)
// and renders the manifest with the interactive review island. P6 (WCAG 2.2 AA): one
// <main> landmark + heading; the review controls live in the labelled, keyboard-operable
// FeatureManifestReview. constitution §5: only redacted feature data is shown, and the
// gate blocks downstream generation until a human decision is recorded here.

import { notFound } from 'next/navigation';
import { getReleaseRun } from '@/app/lib/db/releaseRuns.ts';
import { listFeaturesForRun } from '@/app/lib/db/features.ts';
import { FeatureManifestReview } from '@/app/components/FeatureManifestReview.ts';

// Always reflect the latest manifest + decision state for the run.
export const dynamic = 'force-dynamic';

interface ReviewPageProps {
  readonly params: Promise<{ id: string }>;
}

export default async function ReviewPage({ params }: ReviewPageProps) {
  const { id } = await params;
  const run = await getReleaseRun(id);
  if (run === null) {
    notFound();
  }

  const features = await listFeaturesForRun(run.id);
  const pending = features.filter((f) => f.status === 'pending_review').length;

  return (
    <main id="main">
      <p>
        <a href={`/releases/${run.id}`}>← Back to release run</a>
      </p>
      <h1>Approve feature manifest</h1>
      <p>
        {run.repo} · {run.base_ref}…{run.head_ref}
      </p>
      <p>
        {features.length === 0
          ? 'No candidate features were clustered for this run.'
          : `${features.length} candidate feature${features.length === 1 ? '' : 's'}, ${pending} pending review.`}
      </p>
      <FeatureManifestReview
        releaseRunId={run.id}
        threadId={run.langgraph_thread_id}
        features={features}
      />
    </main>
  );
}
