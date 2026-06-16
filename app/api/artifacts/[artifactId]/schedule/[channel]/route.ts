// POST /api/artifacts/{artifactId}/schedule/{channel} (Path B / Phase 4). Schedules an approved
// post to publish later — the approve-then-schedule flow. Only available when PUBLISH_MODE=scheduled
// (else 409); the human still approved at Gate #2, this only defers EXECUTION (the ratified §2/§5
// reading — not autopublishing). A GitHub Actions cron drains due rows (see the internal run route).
//
// Thin Vercel route: gate on an approved snapshot of the right type for the channel, validate the
// time is in the future, record the accountable human (audit), then upsert the schedule.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { parseBody } from '@/app/lib/featureReview.ts';
import { getApprovedSnapshotForArtifact } from '@/app/lib/db/approvedSnapshots.ts';
import { getArtifactWithClaims } from '@/app/lib/db/claims.ts';
import { recordApprovalIdempotent } from '@/app/lib/db/approvals.ts';
import { schedulePublish, cancelScheduleByArtifactChannel } from '@/app/lib/db/scheduledPublishes.ts';
import { withTransaction } from '@/app/lib/aurora.ts';
import { validateScheduleTime, type ScheduleChannel } from '@/app/lib/scheduledPublish.ts';
import { isXPublishable, isLinkedInPublishable } from '@/app/lib/channelPublish.ts';
import { publishMode } from '@/app/lib/channelDispatch.ts';

export const runtime = 'nodejs';

const scheduleRequestSchema = z
  .object({
    reviewer: z.string().trim().min(1).max(254),
    scheduledAt: z.string().trim().min(1),
  })
  .strict();

interface RouteContext {
  readonly params: Promise<{ artifactId: string; channel: string }>;
}

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  const { artifactId, channel } = await context.params;
  if (channel !== 'linkedin' && channel !== 'x') {
    return NextResponse.json({ error: `unknown channel: ${channel}` }, { status: 404 });
  }
  const chan = channel as ScheduleChannel;

  if (publishMode() !== 'scheduled') {
    return NextResponse.json(
      { error: 'scheduling is disabled (set PUBLISH_MODE=scheduled to enable approve-then-schedule)' },
      { status: 409 },
    );
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: 'request body must be valid JSON' }, { status: 400 });
  }
  const parsed = parseBody(scheduleRequestSchema, raw);
  if (!parsed.ok) {
    return NextResponse.json({ error: 'invalid schedule input', details: parsed.errors }, { status: 400 });
  }

  const when = validateScheduleTime(parsed.value.scheduledAt, new Date());
  if (!when.ok) {
    return NextResponse.json({ error: when.error }, { status: 400 });
  }

  const snapshot = await getApprovedSnapshotForArtifact(artifactId);
  if (snapshot === null) {
    const artifact = await getArtifactWithClaims(artifactId);
    if (artifact === null) {
      return NextResponse.json({ error: 'artifact not found' }, { status: 404 });
    }
    return NextResponse.json(
      { error: 'artifact is not approved: only Gate #2 approved artifacts can be scheduled', status: artifact.status },
      { status: 409 },
    );
  }
  const matches = chan === 'x' ? isXPublishable(snapshot.artifact_type) : isLinkedInPublishable(snapshot.artifact_type);
  if (!matches) {
    return NextResponse.json(
      { error: `this artifact type (${snapshot.artifact_type}) cannot be scheduled to ${chan}` },
      { status: 409 },
    );
  }

  // Record the accountable human (audit). Idempotent per (artifact, channel): a re-schedule keeps
  // the original approval link (the schedule upsert COALESCEs a null approval_id).
  // Record the accountable approval and upsert the schedule ATOMICALLY, so a failed schedule write
  // can't leave an orphaned approval (which would block a retry via the idempotency key). Scheduling
  // authorizes a publish, so it reuses the 'artifact_publish' approval target; the distinct
  // idempotency key keeps it separate from an immediate publish's approval row.
  const row = await withTransaction(async (client) => {
    const approvalId = await recordApprovalIdempotent(
      {
        target_type: 'artifact_publish',
        target_id: artifactId,
        decision: 'approved',
        reviewer: parsed.value.reviewer,
        notes: `schedule_${chan}`,
      },
      `artifact_schedule:${artifactId}:${chan}`,
      client,
    );
    return schedulePublish(
      {
        artifactId,
        releaseRunId: snapshot.release_run_id,
        channel: chan,
        scheduledAtIso: when.iso,
        approvalId,
      },
      client,
    );
  });

  return NextResponse.json({ scheduled: true, schedule: row }, { status: 200 });
}

/** Cancel the pending schedule for this (artifact, channel). 404 when there is nothing pending. */
export async function DELETE(_request: Request, context: RouteContext): Promise<NextResponse> {
  const { artifactId, channel } = await context.params;
  if (channel !== 'linkedin' && channel !== 'x') {
    return NextResponse.json({ error: `unknown channel: ${channel}` }, { status: 404 });
  }
  const cancelled = await cancelScheduleByArtifactChannel(artifactId, channel as ScheduleChannel);
  return cancelled
    ? NextResponse.json({ cancelled: true }, { status: 200 })
    : NextResponse.json({ error: 'no pending schedule to cancel' }, { status: 404 });
}
