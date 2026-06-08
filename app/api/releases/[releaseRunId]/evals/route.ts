// T6 (spec 013) — GET /api/releases/{releaseRunId}/evals (PRD §14 read APIs, §17 metrics).
// P1: thin Vercel route — read the run-scoped eval summary from Aurora and return it as JSON for
// the dashboard. constitution §2/§5: scoped by release_run_id (no cross-run bleed); the response
// carries only metric scores + aggregate counts + the rubric average — never a prompt, evidence,
// artifact body, or PII. Read-only, so no auth-mutation/idempotency concern beyond the gate routes.

import { NextResponse } from 'next/server';
import { getReleaseRun } from '@/app/lib/db/releaseRuns.ts';
import { getRunEvalSummary } from '@/app/lib/db/evalRuns.ts';

export const runtime = 'nodejs';
// Always reflect the latest eval results for the run.
export const dynamic = 'force-dynamic';

interface RouteContext {
  readonly params: Promise<{ releaseRunId: string }>;
}

export async function GET(_request: Request, context: RouteContext): Promise<NextResponse> {
  const { releaseRunId } = await context.params;

  const run = await getReleaseRun(releaseRunId);
  if (run === null) {
    return NextResponse.json({ error: 'release run not found' }, { status: 404 });
  }

  const summary = await getRunEvalSummary(releaseRunId);
  return NextResponse.json(
    { release_run_id: releaseRunId, ...summary },
    { status: 200 },
  );
}
