// T5 (spec 005) — draft-artifact preview page (PRD §13.1, §8.1 blog/changelog).
// Server Component: reads Aurora server-side (no secret or DB handle reaches the client)
// and renders the run's generated drafts via the semantic ArtifactDraftList island. P6
// (WCAG 2.2 AA): one <main> landmark + heading; each draft is a headed <article>.
// constitution §5: only redacted/approved-derived draft content is shown — these drafts are
// not approved (status='draft') until Gate #2 (a later spec).

import { notFound } from 'next/navigation';
import { getReleaseRun } from '@/app/lib/db/releaseRuns.ts';
import { listArtifactsForRun } from '@/app/lib/db/artifacts.ts';
import { ArtifactDraftList } from '@/app/components/ArtifactDraftList.ts';

// Always reflect the latest drafts for the run; not statically cacheable.
export const dynamic = 'force-dynamic';

interface ArtifactsPageProps {
  readonly params: Promise<{ id: string }>;
}

export default async function ArtifactsPage({ params }: ArtifactsPageProps) {
  const { id } = await params;
  const run = await getReleaseRun(id);
  if (run === null) {
    notFound();
  }

  const artifacts = await listArtifactsForRun(run.id);

  return (
    <main id="main">
      <p>
        <a href={`/releases/${run.id}`}>← Back to release run</a>
      </p>
      <h1>Draft artifacts</h1>
      <p>
        {run.repo} · {run.base_ref}…{run.head_ref}
      </p>
      <p>
        {artifacts.length === 0
          ? 'No draft artifacts have been generated for this run yet.'
          : `${artifacts.length} draft artifact${artifacts.length === 1 ? '' : 's'}.`}
      </p>
      <ArtifactDraftList artifacts={artifacts} />
    </main>
  );
}
