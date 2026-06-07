// T5 (spec 002) — run-detail page: shows a release run and its REDACTED evidence
// (PRD §13.1, §6.3). Server Component: it reads Aurora server-side; no secret or DB
// handle, and no raw excerpt, ever reaches the client. P6 (WCAG 2.2 AA): one <main>
// landmark with a heading and the semantic EvidenceTable. Raw blobs are reachable only
// via the presigned-access route the table links to (constitution §4/§5).

import { notFound } from 'next/navigation';
import { getReleaseRun } from '@/app/lib/db/releaseRuns.ts';
import { listEvidenceForRun } from '@/app/lib/db/evidenceItems.ts';
import { EvidenceTable } from '@/app/components/EvidenceTable.ts';
import { CategorizedSignals } from '@/app/components/CategorizedSignals.ts';

// Always reflect the latest evidence for the run; not statically cacheable.
export const dynamic = 'force-dynamic';

interface RunDetailPageProps {
  readonly params: Promise<{ id: string }>;
}

export default async function RunDetailPage({ params }: RunDetailPageProps) {
  const { id } = await params;
  const run = await getReleaseRun(id);
  if (run === null) {
    notFound();
  }

  const evidence = await listEvidenceForRun(run.id);

  return (
    <main id="main">
      <p>
        <a href="/">← All release runs</a>
      </p>
      <h1>Release run {run.repo}</h1>
      <dl>
        <dt>Compare range</dt>
        <dd>
          {run.base_ref}…{run.head_ref}
        </dd>
        <dt>Status</dt>
        <dd>{run.status}</dd>
        <dt>Trigger</dt>
        <dd>{run.trigger_type}</dd>
        <dt>Started</dt>
        <dd>
          <time dateTime={run.started_at}>{run.started_at}</time>
        </dd>
      </dl>

      <h2>Signals by type</h2>
      <CategorizedSignals items={evidence} />

      <h2>Evidence</h2>
      <p>{evidence.length === 1 ? '1 item' : `${evidence.length} items`}</p>
      <EvidenceTable items={evidence} />
    </main>
  );
}
