// Frontend audit — provenance/lineage page for one artifact. Surfaces the evidence→claim→artifact
// trust story (support scores, grounding coverage) that previously lived only in the JSON export.
// Server Component: reads Aurora server-side (no secret or DB handle reaches the client) and
// renders the presentational ProvenanceLineage; 404s when the artifact does not exist.
// P6 (WCAG 2.2 AA): one <main> landmark + heading; the lineage is headed sections with
// text-conveyed status. constitution §5: claims + evidence are built from REDACTED evidence.

import { notFound } from 'next/navigation';
import { getArtifactWithClaims } from '@/app/lib/db/claims.ts';
import { summarizeProvenance } from '@/app/lib/provenanceView.ts';
import { ProvenanceLineage } from '@/app/components/ProvenanceLineage.ts';

// Always reflect the latest claim + support state for the artifact.
export const dynamic = 'force-dynamic';

interface ProvenancePageProps {
  readonly params: Promise<{ artifactId: string }>;
}

export default async function ProvenancePage({ params }: ProvenancePageProps) {
  const { artifactId } = await params;
  const artifact = await getArtifactWithClaims(artifactId);
  if (artifact === null) {
    notFound();
  }

  const summary = summarizeProvenance(artifact.claims);

  return (
    <main id="main">
      <nav aria-label="Breadcrumb">
        <a href="/">All launches</a>
        {' › '}
        <a href={`/releases/${artifact.release_run_id}`}>Launch</a>
        {' › '}
        <a href={`/artifacts/${artifact.id}`}>Claim inspector</a>
        {' › '}
        <span aria-current="page">Provenance</span>
      </nav>
      <h1>Provenance &amp; trust</h1>
      <p>{artifact.title ?? artifact.artifact_type}</p>
      <ProvenanceLineage artifact={artifact} summary={summary} />
    </main>
  );
}
