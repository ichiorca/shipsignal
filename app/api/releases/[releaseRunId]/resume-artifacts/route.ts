// T5 (spec 006) — POST /api/releases/{releaseRunId}/resume-artifacts (PRD §14.1/§14.3).
// Submit the Gate #2 artifact review and resume the content_generation worker past the
// approve_artifacts interrupt. P5 / constitution §5: zod-validated body; the manifest-level
// decision is recorded in the approvals audit log, then the worker is resumed on the SAME
// thread_id (no self-approval — a human reviewer + decision are required). Per-artifact
// approve/reject (and the blocked/unsupported refusal) happen on the per-artifact routes;
// this route resumes the halted graph for the chosen run-level decision.

import { NextResponse } from 'next/server';
import { artifactResumeSchema, parseBody } from '@/app/lib/artifactReview.ts';
import { getReleaseRun } from '@/app/lib/db/releaseRuns.ts';
import { recordApproval } from '@/app/lib/db/approvals.ts';
import { dispatchResume } from '@/app/lib/resumeDispatch.ts';
import { dispatchEval } from '@/app/lib/evalDispatch.ts';
import { sweepApprovedArtifactWebhooks } from '@/app/lib/outboundDispatch.ts';

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

  const parsed = parseBody(artifactResumeSchema, body);
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

  // Record the manifest-level decision (audit trail), then resume the content graph thread.
  await recordApproval({
    target_type: 'artifact_manifest',
    target_id: releaseRunId,
    decision: parsed.value.decision,
    reviewer: parsed.value.reviewer,
    notes: parsed.value.notes,
  });

  try {
    await dispatchResume({
      releaseRunId,
      threadId: parsed.value.thread_id,
      decision: parsed.value.decision,
      graph: 'content_generation',
    });
  } catch (err) {
    // The decision is recorded but the resume dispatch didn't start; report 502 so the
    // operator can retry. Log without leaking secrets (the helper already redacts).
    console.error('gate#2 resume dispatch failed', {
      runId: releaseRunId,
      message: String(err),
    });
    return NextResponse.json(
      { warning: 'decision recorded but resume dispatch failed; retry' },
      { status: 502 },
    );
  }

  // T6 (spec 013) — eval runs AFTER artifact approval (PRD §17 / §8 DoD). On an approved
  // manifest, trigger the worker's deterministic-metrics + LLM-as-judge eval step. Best-effort:
  // a failed eval dispatch must NOT fail the approval (the gate decision already succeeded), so
  // it is surfaced as a non-blocking warning. A rejected/edited manifest produces no shipped
  // content to evaluate, so no eval is triggered.
  let evalTriggered = false;
  if (parsed.value.decision === 'approved') {
    try {
      await dispatchEval({ releaseRunId });
      evalTriggered = true;
    } catch (err) {
      console.error('post-approval eval dispatch failed', {
        runId: releaseRunId,
        message: String(err),
      });
    }
  }

  // T3 (spec 019) — run-level distribution sweep on the approved gate decision: deliver the
  // outbound webhook for any approved artifact still undelivered (covers per-artifact dispatch
  // failures). Fail-soft and ledger-audited; never blocks the gate decision (it already
  // succeeded above). No-op when OUTBOUND_WEBHOOK_URL is unset.
  if (parsed.value.decision === 'approved') {
    await sweepApprovedArtifactWebhooks(releaseRunId);
  }

  return NextResponse.json(
    {
      release_run_id: releaseRunId,
      decision: parsed.value.decision,
      resumed: true,
      eval_triggered: evalTriggered,
    },
    { status: 200 },
  );
}
