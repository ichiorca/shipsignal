// T6 (spec 004) — POST /api/releases/{releaseRunId}/resume (PRD §14.1).
// Submit the Gate #1 manifest review and resume the worker past the interrupt. P5 /
// constitution §5: zod-validated body; the manifest-level decision is recorded in the
// approvals audit log, then the worker is resumed on the SAME thread_id (no self-
// approval — a human reviewer + decision are required). The status update of individual
// features happens on the per-feature routes; this route resumes the halted graph.

import { NextResponse } from 'next/server';
import { resumeSchema, parseBody } from '@/app/lib/featureReview.ts';
import { getReleaseRun } from '@/app/lib/db/releaseRuns.ts';
import { recordApprovalIdempotent, deleteApproval } from '@/app/lib/db/approvals.ts';
import { dispatchResume } from '@/app/lib/resumeDispatch.ts';

export const runtime = 'nodejs';

interface RouteContext {
  readonly params: Promise<{ releaseRunId: string }>;
}

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  const { releaseRunId } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'request body must be valid JSON' }, { status: 400 });
  }

  const parsed = parseBody(resumeSchema, body);
  if (!parsed.ok) {
    return NextResponse.json(
      { error: 'invalid resume input', details: parsed.errors },
      { status: 400 },
    );
  }

  const run = await getReleaseRun(releaseRunId);
  if (run === null) {
    return NextResponse.json({ error: 'release run not found' }, { status: 404 });
  }

  // Record the manifest-level decision (audit trail), then resume the worker thread.
  // Idempotency-guarded: a double-click / retry must not record a second decision or dispatch
  // a second worker for the same gate. `null` means this gate was already resumed.
  const approvalId = await recordApprovalIdempotent(
    {
      target_type: 'feature_manifest',
      target_id: releaseRunId,
      decision: parsed.value.decision,
      reviewer: parsed.value.reviewer,
      notes: parsed.value.notes,
    },
    `feature_manifest:${releaseRunId}`,
  );
  if (approvalId === null) {
    return NextResponse.json(
      { release_run_id: releaseRunId, decision: parsed.value.decision, resumed: true },
      { status: 200 },
    );
  }

  try {
    await dispatchResume({
      releaseRunId,
      decision: parsed.value.decision,
    });
  } catch (err) {
    // The resume dispatch didn't start; clear the dedupe marker so a retry can proceed, then
    // report 502. Log without leaking secrets (the helper already redacts).
    await deleteApproval(approvalId).catch((e: unknown) => console.error("failed to clear dedupe marker; retry may be blocked", { message: e instanceof Error ? e.message : String(e) }));
    console.error('gate#1 resume dispatch failed', {
      runId: releaseRunId,
      message: String(err),
    });
    return NextResponse.json(
      { warning: 'decision recorded but resume dispatch failed; retry' },
      { status: 502 },
    );
  }

  return NextResponse.json(
    { release_run_id: releaseRunId, decision: parsed.value.decision, resumed: true },
    { status: 200 },
  );
}
