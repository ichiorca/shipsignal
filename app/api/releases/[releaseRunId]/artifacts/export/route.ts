// T1 (spec 019) — GET /api/releases/{releaseRunId}/artifacts/export (PRD §14.1/§14.3, §18.1).
// The run-level bundle: every approved artifact for the run as one multi-document JSON file
// (the spec's "zip or multi-doc JSON" — JSON needs no new dependency). P5 / §18.1: assembled
// exclusively from the immutable approved snapshots; artifacts without a Gate #2 approval are
// simply absent. Scoped to one release_run_id (constitution §2 tenancy; no cross-run bleed).

import { NextResponse } from 'next/server';
import { buildExportRecord } from '@/app/lib/artifactExport.ts';
import { listApprovedSnapshotsForRun } from '@/app/lib/db/approvedSnapshots.ts';
import { getReleaseRun } from '@/app/lib/db/releaseRuns.ts';

export const runtime = 'nodejs';

interface RouteContext {
  readonly params: Promise<{ releaseRunId: string }>;
}

export async function GET(_request: Request, context: RouteContext): Promise<NextResponse> {
  const { releaseRunId } = await context.params;

  const run = await getReleaseRun(releaseRunId);
  if (run === null) {
    return NextResponse.json({ error: 'release run not found' }, { status: 404 });
  }

  const snapshots = await listApprovedSnapshotsForRun(run.id);
  const bundle = {
    release_run_id: run.id,
    repo: run.repo,
    artifact_count: snapshots.length,
    artifacts: snapshots.map(buildExportRecord),
  };

  const idPrefix = run.id.replaceAll('-', '').slice(0, 8);
  return NextResponse.json(bundle, {
    status: 200,
    headers: {
      'Content-Disposition': `attachment; filename="release-${idPrefix}-approved-artifacts.json"`,
    },
  });
}
