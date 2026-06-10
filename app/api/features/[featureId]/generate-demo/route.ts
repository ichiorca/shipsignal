// T1 (spec 014) — POST /api/features/{featureId}/generate-demo (PRD §14.5).
// P1 (Substrate): thin Vercel route — it validates, records the accountable reviewer, and
// dispatches the media_generation Actions job; the Playwright/ffmpeg/ElevenLabs work runs on
// the runner, never here. P5 / constitution §5: the body is zod-validated; media is generated
// only from an APPROVED feature (a demo derives from Gate#2-approved content), so an unknown or
// not-yet-approved feature is a 404 / 409 and no worker is dispatched. The reviewer is recorded
// in the approvals audit log BEFORE dispatch so the trigger always names an accountable human.

import { NextResponse } from 'next/server';
import { generateDemoSchema } from '@/app/lib/mediaTrigger.ts';
import { parseBody } from '@/app/lib/featureReview.ts';
import { getFeature } from '@/app/lib/db/features.ts';
import { getReleaseRun } from '@/app/lib/db/releaseRuns.ts';
import { recordApproval } from '@/app/lib/db/approvals.ts';
import { dispatchMediaGeneration } from '@/app/lib/mediaDispatch.ts';

// Aurora + GitHub dispatch require the Node.js runtime (not Edge); secrets stay server-side.
export const runtime = 'nodejs';

interface RouteContext {
  readonly params: Promise<{ featureId: string }>;
}

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  const { featureId } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'request body must be valid JSON' }, { status: 400 });
  }

  const parsed = parseBody(generateDemoSchema, body);
  if (!parsed.ok) {
    return NextResponse.json(
      { error: 'invalid generate-demo input', details: parsed.errors },
      { status: 400 },
    );
  }

  const feature = await getFeature(featureId);
  if (feature === null) {
    return NextResponse.json({ error: 'feature not found' }, { status: 404 });
  }
  // Media is generated only from an approved feature (its demo_script is Gate#2-approved
  // downstream of Gate#1 approval). Refuse anything not yet approved — never silently render.
  if (feature.status !== 'approved') {
    return NextResponse.json(
      { error: 'feature is not approved; cannot generate demo media', status: feature.status },
      { status: 409 },
    );
  }

  // T4 (spec 022): demo media derives from an approved demo_script — a run that
  // deselected demo_script at creation can never have one, so refuse with a user-safe
  // explanation rather than dispatching a worker that would fail closed downstream.
  const run = await getReleaseRun(feature.release_run_id);
  if (run === null) {
    return NextResponse.json({ error: 'release run not found' }, { status: 404 });
  }
  if (!run.artifact_types.includes('demo_script')) {
    return NextResponse.json(
      {
        error:
          'demo media is unavailable for this run: the demo_script artifact type was not ' +
          'selected when the run was created',
      },
      { status: 409 },
    );
  }

  // Record the accountable reviewer who triggered generation (audit trail) before dispatch.
  await recordApproval({
    target_type: 'media_trigger',
    target_id: featureId,
    decision: 'approved',
    reviewer: parsed.value.reviewer,
    notes: parsed.value.notes,
  });

  try {
    await dispatchMediaGeneration({
      releaseRunId: feature.release_run_id,
      featureId,
    });
  } catch (err) {
    // The trigger is recorded but the job didn't start; report 502 so the operator can retry.
    // Log without leaking secrets (the helper already redacts to status-only).
    console.error('generate-demo dispatch failed', {
      featureId,
      runId: feature.release_run_id,
      message: String(err),
    });
    return NextResponse.json(
      { warning: 'trigger recorded but media dispatch failed; retry' },
      { status: 502 },
    );
  }

  return NextResponse.json(
    { feature_id: featureId, release_run_id: feature.release_run_id, dispatched: true },
    { status: 202 },
  );
}
