// T5 (spec 015) — standalone Claim-inspector screen (PRD §13.1): for one artifact, every
// claim with its support status, risk flags, and linked evidence. Server Component: reads
// Aurora server-side (no secret or DB handle reaches the client) and renders the
// presentational ClaimInspector; 404s when the artifact does not exist. P6 (WCAG 2.2 AA):
// one <main> landmark + heading; claims are headed sections with text-conveyed status.
// constitution §5: claims + evidence are built from REDACTED evidence, so no raw text is
// rendered.

import { notFound } from 'next/navigation';
import { getArtifactWithClaims } from '@/app/lib/db/claims.ts';
import { ArtifactExportActions } from '@/app/components/ArtifactExportActions.ts';
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

  return (
    <main id="main">
      <p>
        <a href={`/releases/${artifact.release_run_id}/artifacts`}>← Back to artifacts</a>
      </p>
      <h1>Claim inspector</h1>
      <p>
        {artifact.title ?? artifact.artifact_type} ·{' '}
        {artifact.claims.length === 1 ? '1 claim' : `${artifact.claims.length} claims`}
      </p>
      {/* T2 (spec 019) — an approved artifact exposes its §18.1 snapshot for copy/download. */}
      {artifact.status === 'approved' ? (
        <ArtifactExportActions
          artifactId={artifact.id}
          artifactLabel={artifact.title ?? artifact.artifact_type}
        />
      ) : null}
      <ClaimInspector artifact={artifact} />
    </main>
  );
}
