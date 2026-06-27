// POST /api/artifacts/{artifactId}/publish/slack (operator feedback 2026-06-09, priority 1).
// Announces ONE approved artifact in Slack via the same incoming-webhook env the spec-020
// reviewer notifications use — one click from Gate #2 approval to a team announcement.
//
// P1 (Substrate): thin Vercel route. P5 / §18.1: only the immutable Gate #2 snapshot is
// announceable; the message carries no reviewer identity, no evidence excerpts; the webhook
// URL (a credential, spec 020) stays server-side and is never logged. constitution §2:
// human-gated distribution, not autopublishing. 503 when Slack is unconfigured (feature off).

import { NextResponse } from 'next/server';
import { publishRequestSchema, buildSlackAnnouncement } from '@/app/lib/publish.ts';
import { slackConfigured, announceToSlack } from '@/app/lib/publishDispatch.ts';
import { getApprovedSnapshotForArtifact } from '@/app/lib/db/approvedSnapshots.ts';
import { getArtifactWithClaims } from '@/app/lib/db/claims.ts';
import { beginApprovalDispatch, completeApprovalDispatch, deleteApproval } from '@/app/lib/db/approvals.ts';
import { parseBody } from '@/app/lib/featureReview.ts';
import { optionalEnv } from '@/app/lib/env.ts';

// Aurora + the webhook call require the Node.js runtime (not Edge).
export const runtime = 'nodejs';

interface RouteContext {
  readonly params: Promise<{ artifactId: string }>;
}

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  const { artifactId } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'request body must be valid JSON' }, { status: 400 });
  }
  const parsed = parseBody(publishRequestSchema, body);
  if (!parsed.ok) {
    return NextResponse.json(
      { error: 'invalid publish input', details: parsed.errors },
      { status: 400 },
    );
  }

  if (!slackConfigured()) {
    return NextResponse.json(
      { error: 'Slack is not configured for this deployment (SLACK_WEBHOOK_URL is unset)' },
      { status: 503 },
    );
  }

  const snapshot = await getApprovedSnapshotForArtifact(artifactId);
  if (snapshot === null) {
    const artifact = await getArtifactWithClaims(artifactId);
    if (artifact === null) {
      return NextResponse.json({ error: 'artifact not found' }, { status: 404 });
    }
    return NextResponse.json(
      {
        error:
          'artifact is not approved: only artifacts approved at Gate #2 can be announced',
        status: artifact.status,
      },
      { status: 409 },
    );
  }

  // Two-phase idempotent dispatch: acquire a 'pending' marker (records the accountable human,
  // §10.4) BEFORE the outward call. A double-click that finds a completed marker is an idempotent
  // success; one that finds a still-pending marker (a concurrent announce mid-flight) gets 409
  // 'in_flight' rather than a false 'published'. The marker is only marked completed once Slack
  // has actually accepted the message, and is deleted on failure so a retry can re-acquire it.
  const acquire = await beginApprovalDispatch(
    {
      target_type: 'artifact_publish',
      target_id: artifactId,
      decision: 'approved',
      reviewer: parsed.value.reviewer,
      notes: parsed.value.notes ?? 'slack_announce',
    },
    `artifact_publish:${artifactId}:slack`,
  );
  if (acquire.kind === 'completed') {
    return NextResponse.json(
      { published: true, destination: 'slack', idempotent: true },
      { status: 200 },
    );
  }
  if (acquire.kind === 'in_flight') {
    return NextResponse.json(
      {
        error: 'a Slack announce for this artifact is already in progress; refresh to see its result before retrying',
        inFlight: true,
      },
      { status: 409 },
    );
  }
  const approvalId = acquire.id;

  try {
    await announceToSlack(
      buildSlackAnnouncement(snapshot, optionalEnv('DASHBOARD_BASE_URL', '')),
    );
    await completeApprovalDispatch(approvalId);
    return NextResponse.json({ published: true, destination: 'slack' }, { status: 200 });
  } catch (err) {
    // The outward call failed; clear the dedupe marker so a retry can proceed, then report 502.
    await deleteApproval(approvalId).catch((e: unknown) => console.error("failed to clear dedupe marker; retry may be blocked", { message: e instanceof Error ? e.message : String(e) }));
    console.error('slack announce failed', { artifactId, message: String(err) });
    return NextResponse.json(
      { error: 'announcing in Slack failed; check the server logs and retry' },
      { status: 502 },
    );
  }
}
