// Path B / Phase 3 — shared handler for the LinkedIn/X publish routes (DRY: both routes are the
// same flow with a different builder + dispatcher). Mirrors the Slack route's contract:
//
//  - only a Gate #2 approved snapshot is publishable (404 unknown / 409 not-approved / 409 wrong
//    channel for the artifact type);
//  - a REAL send records an idempotent, accountable approval BEFORE the outward call (audit, §10.4)
//    and is per-destination idempotent (a double-click never double-posts);
//  - a DRY-RUN (channel unconfigured / forced) is a pure preview — no audit row, no idempotency
//    marker — so it stays re-runnable and never blocks a later real publish.
//
// P5/§18.1: the post is built only from the immutable snapshot; credentials stay server-side.

import 'server-only';
import { NextResponse } from 'next/server';
import { publishRequestSchema } from '@/app/lib/publish.ts';
import { parseBody } from '@/app/lib/featureReview.ts';
import { getApprovedSnapshotForArtifact } from '@/app/lib/db/approvedSnapshots.ts';
import { getArtifactWithClaims } from '@/app/lib/db/claims.ts';
import { beginApprovalDispatch, completeApprovalDispatch, deleteApproval } from '@/app/lib/db/approvals.ts';
import { willDryRun, type ChannelName, type ChannelPublishResult } from '@/app/lib/channelDispatch.ts';
import { decideChannelPublish, type ChannelPublishDeps } from '@/app/lib/channelPublishLogic.ts';
import type { ChannelPost } from '@/app/lib/channelPublish.ts';
import type { ApprovedSnapshotView } from '@/app/lib/artifactExport.ts';

export interface ChannelPublishOptions {
  readonly channel: ChannelName;
  readonly label: string;
  readonly isPublishable: (artifactType: string) => boolean;
  readonly build: (snapshot: ApprovedSnapshotView) => ChannelPost;
  readonly dispatch: (post: ChannelPost) => Promise<ChannelPublishResult>;
}

export async function handleChannelPublish(
  request: Request,
  artifactId: string,
  opts: ChannelPublishOptions,
): Promise<NextResponse> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: 'request body must be valid JSON' }, { status: 400 });
  }
  const parsed = parseBody(publishRequestSchema, raw);
  if (!parsed.ok) {
    return NextResponse.json(
      { error: 'invalid publish input', details: parsed.errors },
      { status: 400 },
    );
  }

  // Wire the real Aurora + dispatch I/O into the (unit-tested) decision logic.
  const deps: ChannelPublishDeps = {
    getSnapshot: getApprovedSnapshotForArtifact,
    getArtifactStatus: async (id) => (await getArtifactWithClaims(id))?.status ?? null,
    beginDispatch: beginApprovalDispatch,
    completeDispatch: completeApprovalDispatch,
    deleteApproval,
    willDryRun,
    isPublishable: opts.isPublishable,
    build: opts.build,
    dispatch: opts.dispatch,
  };
  const result = await decideChannelPublish(
    { artifactId, channel: opts.channel, reviewer: parsed.value.reviewer, notes: parsed.value.notes },
    deps,
  );
  if (result.status >= 500) {
    console.error(`${opts.channel} publish failed`, { artifactId, status: result.status });
  }
  return NextResponse.json(result.body, { status: result.status });
}
