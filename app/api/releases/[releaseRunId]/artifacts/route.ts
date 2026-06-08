// T3 (spec 015) — GET /api/releases/{releaseRunId}/artifacts (PRD §14.3). Read-only:
// returns a run's generated artifacts (drafts + audit metadata) from Aurora, or 404 if
// the run does not exist.
// P5 / constitution §5: drafts are built from approved features (themselves from redacted
// evidence), so the response renders no raw text; scoped by release_run_id (the tenancy
// key). The resolution logic lives in the unit-tested readApi helper.

import { NextResponse } from 'next/server';
import { getReleaseRun } from '@/app/lib/db/releaseRuns.ts';
import { listArtifactsForRun } from '@/app/lib/db/artifacts.ts';
import { resolveScopedList } from '@/app/lib/readApi.ts';

export const runtime = 'nodejs';

interface RouteContext {
  readonly params: Promise<{ releaseRunId: string }>;
}

export async function GET(_request: Request, context: RouteContext): Promise<NextResponse> {
  const { releaseRunId } = await context.params;
  const result = await resolveScopedList(
    () => getReleaseRun(releaseRunId),
    'release run not found',
    () => listArtifactsForRun(releaseRunId),
    (artifacts) => ({ artifacts }),
  );
  return NextResponse.json(result.body, { status: result.status });
}
