// T6 (spec 008) — demo-media preview page (PRD §5.4 / §13.1). Server Component: reads Aurora
// server-side (no secret or DB handle reaches the client) and renders each rendered media asset
// with the accessible MediaPreview player. P6 (WCAG 2.2 AA): one <main> landmark + heading; the
// players are native, keyboard-operable controls with accessible names. constitution §4/§5: only
// the S3 key + provenance are read here, and the media itself is reached solely through the
// short-expiry presigned-URL playback route (the player's <source>), never a public S3 object.

import { notFound } from 'next/navigation';
import { getReleaseRun } from '@/app/lib/db/releaseRuns.ts';
import { listMediaAssetsForRun } from '@/app/lib/db/mediaAssets.ts';
import { listFeaturesForRun } from '@/app/lib/db/features.ts';
import { MediaPreview } from '@/app/components/MediaPreview.ts';
import { GenerateDemoButton } from '@/app/components/GenerateDemoButton.ts';

// Always reflect the latest media assets for the run.
export const dynamic = 'force-dynamic';

interface MediaPageProps {
  readonly params: Promise<{ id: string }>;
}

export default async function MediaPreviewPage({ params }: MediaPageProps) {
  const { id } = await params;
  const run = await getReleaseRun(id);
  if (run === null) {
    notFound();
  }

  const assets = await listMediaAssetsForRun(run.id);
  // T4 (spec 022): demo media depends on the demo_script artifact type — if it was
  // deselected at run creation the page says WHY generation is unavailable, rather than
  // showing a generic "nothing yet" that implies media may still arrive.
  const demoScriptSelected = run.artifact_types.includes('demo_script');
  // Demo media is generated per APPROVED feature (from its Gate#2-approved demo script), so the
  // trigger is offered for each approved feature of the run (spec 014, PRD §14.5).
  const features = await listFeaturesForRun(run.id);
  const approvedFeatures = features.filter((feature) => feature.status === 'approved');

  return (
    <main id="main">
      <nav aria-label="Breadcrumb">
        <a href="/">All launches</a>
        {' › '}
        <a href={`/releases/${run.id}`}>Launch</a>
        {' › '}
        <span aria-current="page">Demo media</span>
      </nav>
      <h1>Demo media</h1>
      <p>
        {run.repo} · {run.base_ref}…{run.head_ref}
      </p>
      {!demoScriptSelected ? (
        <p>
          Demo generation is unavailable for this run: the demo script artifact type was
          not selected when the run was created, and demo media requires an approved demo
          script.
        </p>
      ) : (
        <>
          <p>
            {assets.length === 0
              ? 'No demo media has been generated for this run yet.'
              : `${assets.length} media asset${assets.length === 1 ? '' : 's'}.`}
          </p>
          <section aria-labelledby="generate-demo-heading">
            <h2 id="generate-demo-heading">Generate a demo</h2>
            {approvedFeatures.length === 0 ? (
              <p>
                Demo media is generated from an approved feature&apos;s demo script. Approve a
                feature at Gate #1 first, then return here to render its demo.
              </p>
            ) : (
              <ul>
                {approvedFeatures.map((feature) => (
                  <li key={feature.id}>
                    <p>{feature.title}</p>
                    <GenerateDemoButton featureId={feature.id} featureLabel={feature.title} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
      <MediaPreview assets={assets} />
    </main>
  );
}
