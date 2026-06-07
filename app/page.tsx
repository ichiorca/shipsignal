// T6 (spec 001) — release feed (run list), the dashboard entry point (PRD §13.1).
// Server Component: it reads from Aurora server-side and renders the run list; no
// secret or DB handle ever reaches the client. P6 (WCAG 2.2 AA): one <main> landmark
// with a heading, and the semantic RunListTable.

import { listReleaseRuns } from '@/app/lib/db/releaseRuns.ts';
import { RunListTable } from '@/app/components/RunListTable.ts';

// Always reflect the latest runs; this feed is not statically cacheable.
export const dynamic = 'force-dynamic';

export default async function ReleaseFeedPage() {
  const runs = await listReleaseRuns();
  return (
    <main id="main">
      <h1>Release runs</h1>
      <p>{runs.length === 1 ? '1 run' : `${runs.length} runs`}</p>
      <RunListTable runs={runs} />
    </main>
  );
}
