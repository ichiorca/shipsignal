// T6 (spec 008) — demo-media preview page (PRD §5.4 / §13.1). Server Component: reads Aurora
// server-side (no secret or DB handle reaches the client) and renders each rendered media asset
// with the accessible MediaPreview player. P6 (WCAG 2.2 AA): one <main> landmark + heading; the
// players are native, keyboard-operable controls with accessible names. constitution §4/§5: only
// the S3 key + provenance are read here, and the media itself is reached solely through the
// short-expiry presigned-URL playback route (the player's <source>), never a public S3 object.

import { notFound } from 'next/navigation';
import { getReleaseRun } from '@/app/lib/db/releaseRuns.ts';
import { listMediaAssetsForRun } from '@/app/lib/db/mediaAssets.ts';
import { MediaPreview } from '@/app/components/MediaPreview.ts';

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

  return (
    <main id="main">
      <p>
        <a href={`/releases/${run.id}`}>← Back to release run</a>
      </p>
      <h1>Demo media</h1>
      <p>
        {run.repo} · {run.base_ref}…{run.head_ref}
      </p>
      <p>
        {assets.length === 0
          ? 'No demo media has been generated for this run yet.'
          : `${assets.length} media asset${assets.length === 1 ? '' : 's'}.`}
      </p>
      <MediaPreview assets={assets} />
    </main>
  );
}
