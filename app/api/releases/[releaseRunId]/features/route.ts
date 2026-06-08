// T3 (spec 015) — GET /api/releases/{releaseRunId}/features (PRD §14.2). Read-only:
// returns a run's feature clusters (each with its linked REDACTED evidence) from Aurora,
// or 404 if the run does not exist.
// P5 / constitution §5: the manifest is built from redacted evidence, so the response
// carries no raw text; scoped by release_run_id (the tenancy key, no cross-run bleed).
// The 404-on-missing-run vs 200-with-list logic lives in the unit-tested readApi helper.

import { NextResponse } from 'next/server';
import { getReleaseRun } from '@/app/lib/db/releaseRuns.ts';
import { listFeaturesForRun } from '@/app/lib/db/features.ts';
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
    () => listFeaturesForRun(releaseRunId),
    (features) => ({ features }),
  );
  return NextResponse.json(result.body, { status: result.status });
}
