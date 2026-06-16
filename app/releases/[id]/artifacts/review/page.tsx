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
import { listSchedulesForRun } from '@/app/lib/db/scheduledPublishes.ts';
import { suggestNextWindow, type ScheduledPublishView } from '@/app/lib/scheduledPublish.ts';
import { publishMode } from '@/app/lib/channelDispatch.ts';
import { ArtifactReview } from '@/app/components/ArtifactReview.ts';
import { typeLabel } from '@/app/lib/artifactTypes.ts';

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

  // Two independent reads in parallel — the artifacts+claims and the run's schedules.
  const [artifacts, scheduleRows] = await Promise.all([
    listArtifactsWithClaimsForRun(run.id),
    listSchedulesForRun(run.id),
  ]);
  const blocked = artifacts.filter((a) => a.status === 'blocked').length;
  const approved = artifacts.filter((a) => a.status === 'approved').length;

  // Phase 4 — approve-then-schedule context for the inline schedule controls. Group the run's
  // schedules by artifact so each approved post shows its own pending/sent state.
  const schedulingEnabled = publishMode() === 'scheduled';
  const schedulesByArtifact = scheduleRows.reduce<Record<string, ScheduledPublishView[]>>(
    (acc, row) => {
      (acc[row.artifact_id] ??= []).push(row);
      return acc;
    },
    {},
  );

  return (
    <main id="main">
      <nav aria-label="Breadcrumb">
        <a href="/">All launches</a>
        {' › '}
        <a href={`/releases/${run.id}`}>Launch</a>
        {' › '}
        <span aria-current="page">Review artifacts (Gate #2)</span>
      </nav>
      <h1>Review artifacts (Gate #2)</h1>
      <p>
        {run.repo} · {run.base_ref}…{run.head_ref}
      </p>
      {/* T4 (spec 022): only the run's selected types are generated and reviewed here —
          run-level approve/reject (in ArtifactReview) operates over exactly this subset. */}
      <p>
        Artifact types selected for this run:{' '}
        {run.artifact_types.map((t) => typeLabel(t)).join(', ')}.
      </p>
      <p>
        {artifacts.length === 0
          ? 'No artifacts have been generated for this run yet.'
          : `${artifacts.length} artifact${artifacts.length === 1 ? '' : 's'}, ${blocked} blocked by a check.`}
      </p>
      {/* T2 (spec 019) — run-level export of every approved artifact (the §18.1 snapshots). */}
      {approved > 0 ? (
        <p>
          <a href={`/api/releases/${run.id}/artifacts/export`}>
            Download all approved artifacts (JSON bundle)
          </a>
        </p>
      ) : null}
      <ArtifactReview
        releaseRunId={run.id}
        threadId={run.langgraph_thread_id}
        artifacts={artifacts}
        schedulingEnabled={schedulingEnabled}
        suggestedTimeIso={suggestNextWindow(new Date())}
        schedulesByArtifact={schedulesByArtifact}
      />
    </main>
  );
}
