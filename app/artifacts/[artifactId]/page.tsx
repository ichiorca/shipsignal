// T5 (spec 015) — standalone Claim-inspector screen (PRD §13.1): for one artifact, every
// claim with its support status, risk flags, and linked evidence. Server Component: reads
// Aurora server-side (no secret or DB handle reaches the client) and renders the
// presentational ClaimInspector; 404s when the artifact does not exist. P6 (WCAG 2.2 AA):
// one <main> landmark + heading; claims are headed sections with text-conveyed status.
// constitution §5: claims + evidence are built from REDACTED evidence, so no raw text is
// rendered.

import { notFound } from 'next/navigation';
import { getArtifactWithClaims } from '@/app/lib/db/claims.ts';
import { listSchedulesForArtifact } from '@/app/lib/db/scheduledPublishes.ts';
import { suggestNextWindow } from '@/app/lib/scheduledPublish.ts';
import { publishMode } from '@/app/lib/channelDispatch.ts';
import { ArtifactExportActions } from '@/app/components/ArtifactExportActions.ts';
import { SchedulePublish } from '@/app/components/SchedulePublish.ts';
import { ClaimInspector } from '@/app/components/ClaimInspector.ts';

// Always reflect the latest claim + support state for the artifact.
export const dynamic = 'force-dynamic';

interface ClaimInspectorPageProps {
  readonly params: Promise<{ artifactId: string }>;
}

export default async function ClaimInspectorPage({ params }: ClaimInspectorPageProps) {
  const { artifactId } = await params;
  const artifact = await getArtifactWithClaims(artifactId);
  if (artifact === null) {
    notFound();
  }

  // Phase 4 — scheduling data for an approved post (the component renders nothing for a
  // non-schedulable type, e.g. a blog or Hacker News post).
  const schedulingEnabled = publishMode() === 'scheduled';
  const schedules =
    artifact.status === 'approved' ? await listSchedulesForArtifact(artifact.id) : [];

  return (
    <main id="main">
      <p>
        <a href={`/releases/${artifact.release_run_id}/artifacts`}>← Back to artifacts</a>
      </p>
      <h1>Claim inspector</h1>
      <p>
        {artifact.title ?? artifact.artifact_type} ·{' '}
        {artifact.claims.length === 1 ? '1 claim' : `${artifact.claims.length} claims`} ·{' '}
        <a href={`/artifacts/${artifact.id}/provenance`}>Why we can say this →</a>
      </p>
      {/* T2 (spec 019) — an approved artifact exposes its §18.1 snapshot for copy/download, plus
          one-click publish to its real destinations. `artifactType` enables the publish buttons
          (the component supplies its own reviewer field here, since this page has no gate form). */}
      {artifact.status === 'approved' ? (
        <ArtifactExportActions
          artifactId={artifact.id}
          artifactLabel={artifact.title ?? artifact.artifact_type}
          artifactType={artifact.artifact_type}
        />
      ) : null}
      {artifact.status === 'approved' ? (
        <SchedulePublish
          artifactId={artifact.id}
          artifactType={artifact.artifact_type}
          schedulingEnabled={schedulingEnabled}
          suggestedTimeIso={suggestNextWindow(new Date())}
          schedules={schedules}
        />
      ) : null}
      <ClaimInspector artifact={artifact} />
    </main>
  );
}
