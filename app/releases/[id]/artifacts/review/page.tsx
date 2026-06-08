// T5 (spec 006) — Gate #2 artifact-review page (PRD §5.6, §13.1).
// Server Component: reads Aurora server-side (no secret or DB handle reaches the client) and
// renders each artifact + its claims/evidence with the interactive review island. P6 (WCAG
// 2.2 AA): one <main> landmark + heading; the review controls live in the labelled,
// keyboard-operable ArtifactReview. constitution §5: only redacted claim/evidence data is
// shown, and the gate blocks publishing until a human decision is recorded here — a blocked
// artifact (failed check) cannot be approved.

import { notFound } from 'next/navigation';
import { getReleaseRun } from '@/app/lib/db/releaseRuns.ts';
import { listArtifactsWithClaimsForRun } from '@/app/lib/db/claims.ts';
import { ArtifactReview } from '@/app/components/ArtifactReview.ts';

// Always reflect the latest artifacts + decision state for the run.
export const dynamic = 'force-dynamic';

interface ReviewPageProps {
  readonly params: Promise<{ id: string }>;
}

export default async function ArtifactReviewPage({ params }: ReviewPageProps) {
  const { id } = await params;
  const run = await getReleaseRun(id);
  if (run === null) {
    notFound();
  }

  const artifacts = await listArtifactsWithClaimsForRun(run.id);
  const blocked = artifacts.filter((a) => a.status === 'blocked').length;

  return (
    <main id="main">
      <p>
        <a href={`/releases/${run.id}`}>← Back to release run</a>
      </p>
      <h1>Review artifacts (Gate #2)</h1>
      <p>
        {run.repo} · {run.base_ref}…{run.head_ref}
      </p>
      <p>
        {artifacts.length === 0
          ? 'No artifacts have been generated for this run yet.'
          : `${artifacts.length} artifact${artifacts.length === 1 ? '' : 's'}, ${blocked} blocked by a check.`}
      </p>
      <ArtifactReview
        releaseRunId={run.id}
        threadId={run.langgraph_thread_id}
        artifacts={artifacts}
      />
    </main>
  );
}
