// T3 (spec 015) — GET /api/releases/{releaseRunId} (PRD §14.1). Read-only: returns one
// release run's typed record from Aurora, or 404 if it does not exist.
// P1 (Substrate): a thin Vercel read route — it only reads Aurora server-side and shapes
// the response; the long job runs on the Actions runner. P5 / constitution §5: no secret
// or DB handle reaches the client; the resolution logic lives in the unit-tested
// readApi helper.

import { NextResponse } from 'next/server';
import { getReleaseRun } from '@/app/lib/db/releaseRuns.ts';
import { resolveOne } from '@/app/lib/readApi.ts';

// Aurora access requires the Node.js runtime (not Edge).
export const runtime = 'nodejs';

interface RouteContext {
  readonly params: Promise<{ releaseRunId: string }>;
}

export async function GET(_request: Request, context: RouteContext): Promise<NextResponse> {
  const { releaseRunId } = await context.params;
  const result = await resolveOne(
    () => getReleaseRun(releaseRunId),
    'release run not found',
    (run) => ({ run }),
  );
  return NextResponse.json(result.body, { status: result.status });
}
