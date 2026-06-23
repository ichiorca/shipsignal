// T3 (spec 001) — POST /api/releases (create a manual compare-range run) + GET (list).
// P1 (Substrate): this thin Vercel route only validates, persists, and dispatches —
// the long job runs on the Actions runner. P5: untrusted body is zod-validated before
// it touches Aurora or GitHub; the GitHub token stays server-side.

import { NextResponse } from 'next/server';
import { parseCreateReleaseRun } from '@/app/lib/releaseInput.ts';
import { insertReleaseRun, listReleaseRuns } from '@/app/lib/db/releaseRuns.ts';
import { dispatchReleaseRunWorkflow } from '@/app/lib/githubDispatch.ts';
import { parseLimit } from '@/app/lib/readApi.ts';
import { DEFAULT_ARTIFACT_TYPES } from '@/app/lib/artifactTypesDefault.ts';

// Aurora + GitHub calls require the Node.js runtime (not Edge).
export const runtime = 'nodejs';

export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'request body must be valid JSON' }, { status: 400 });
  }

  const parsed = parseCreateReleaseRun(body);
  if (!parsed.ok) {
    return NextResponse.json(
      { error: 'invalid release run input', details: parsed.errors },
      { status: 400 },
    );
  }

  // Persist first (status=created) so the run exists even if dispatch is retried.
  // T1 (spec 022): the validated selection is persisted on the run row (immutable after
  // creation); an omitted selection falls back to the configured default set.
  const run = await insertReleaseRun({
    repo: parsed.value.repo,
    base_ref: parsed.value.base_ref,
    head_ref: parsed.value.head_ref,
    trigger_type: 'manual',
    artifact_types: parsed.value.artifact_types ?? DEFAULT_ARTIFACT_TYPES,
    ...(parsed.value.project_id ? { project_id: parsed.value.project_id } : {}),
  });

  try {
    await dispatchReleaseRunWorkflow({
      releaseRunId: run.id,
      repo: run.repo,
      baseRef: run.base_ref,
      headRef: run.head_ref,
    });
  } catch (err) {
    // The run is created but the job didn't start; report 502 so the operator can
    // resume. Log without leaking secrets (the helper already redacts).
    console.error('release-run dispatch failed', { runId: run.id, message: String(err) });
    return NextResponse.json(
      { run, warning: 'run created but workflow dispatch failed; retry resume' },
      { status: 502 },
    );
  }

  return NextResponse.json({ run }, { status: 201 });
}

export async function GET(request: Request): Promise<NextResponse> {
  const runs = await listReleaseRuns(parseLimit(request.url, 50, 200));
  return NextResponse.json({ runs });
}
