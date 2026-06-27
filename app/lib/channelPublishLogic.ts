// Path B / Phase 3 — the channel-publish DECISION logic, extracted from the route so it is unit-
// testable without a DB, network, server-only, or next/server. The route (channelPublishRoute.ts)
// parses/validates the request, injects the real Aurora + dispatch deps, and renders the returned
// {status, body} as a NextResponse. Everything interesting — the approved-snapshot gate, the
// type gate, the dry-run-vs-real branch, per-destination idempotency, and the delete-on-failure
// rollback — lives here and is covered by tests/channelPublishLogic.test.ts.

import type { ApprovedSnapshotView } from './artifactExport.ts';
import type { ChannelPost } from './channelPublish.ts';
import type { ChannelName, ChannelPublishResult } from './channelDispatch.ts';
import type { DispatchAcquire } from './db/approvals.ts';

export interface ApprovalRecordInput {
  readonly target_type: 'artifact_publish';
  readonly target_id: string;
  readonly decision: 'approved';
  readonly reviewer: string;
  readonly notes: string;
}

/** The I/O the decision needs, injected so tests can supply fakes (no DB / network / server-only). */
export interface ChannelPublishDeps {
  readonly getSnapshot: (artifactId: string) => Promise<ApprovedSnapshotView | null>;
  /** The artifact's current status, or null when the artifact does not exist (drives 404 vs 409). */
  readonly getArtifactStatus: (artifactId: string) => Promise<string | null>;
  /** Phase 1: acquire a 'pending' dispatch marker (two-phase, so a concurrent caller mid-dispatch
   *  is told 'in_flight' instead of a false 'published'). */
  readonly beginDispatch: (input: ApprovalRecordInput, idempotencyKey: string) => Promise<DispatchAcquire>;
  /** Phase 2: mark the acquired marker completed after a successful outward send. */
  readonly completeDispatch: (approvalId: string) => Promise<void>;
  readonly deleteApproval: (approvalId: string) => Promise<void>;
  readonly willDryRun: (channel: ChannelName) => boolean;
  readonly isPublishable: (artifactType: string) => boolean;
  readonly build: (snapshot: ApprovedSnapshotView) => ChannelPost;
  readonly dispatch: (post: ChannelPost) => Promise<ChannelPublishResult>;
}

export interface ChannelPublishCommand {
  readonly artifactId: string;
  readonly channel: ChannelName;
  readonly reviewer: string;
  readonly notes?: string | undefined;
}

export interface RouteResult {
  readonly status: number;
  readonly body: Readonly<Record<string, unknown>>;
}

/** Decide the outcome of a channel publish. Mirrors the Slack route's contract:
 *  404 unknown · 409 not-approved · 409 wrong-channel · 200 dry-run preview (no audit/idempotency)
 *  · 200 idempotent (a prior send completed) · 409 in-flight (a concurrent send is mid-dispatch)
 *  · 200 published · 502 (and the pending marker is rolled back). */
export async function decideChannelPublish(
  cmd: ChannelPublishCommand,
  deps: ChannelPublishDeps,
): Promise<RouteResult> {
  const snapshot = await deps.getSnapshot(cmd.artifactId);
  if (snapshot === null) {
    const status = await deps.getArtifactStatus(cmd.artifactId);
    if (status === null) {
      return { status: 404, body: { error: 'artifact not found' } };
    }
    return {
      status: 409,
      body: { error: 'artifact is not approved: only artifacts approved at Gate #2 can be published', status },
    };
  }
  if (!deps.isPublishable(snapshot.artifact_type)) {
    return {
      status: 409,
      body: { error: `this artifact type (${snapshot.artifact_type}) cannot be published to ${cmd.channel}` },
    };
  }

  const post = deps.build(snapshot);

  // Dry-run: pure preview — no audit row, no idempotency marker (re-runnable; never blocks a real send).
  if (deps.willDryRun(cmd.channel)) {
    const result = await deps.dispatch(post);
    return {
      status: 200,
      body: { published: false, dryRun: true, destination: cmd.channel, preview: post.text, url: result.url },
    };
  }

  // Real send: acquire a two-phase dispatch marker (records the accountable human) BEFORE the
  // outward call. The marker is 'pending' until the send succeeds, so a concurrent double-click
  // is told 'in_flight' rather than a false 'published' — and if this send then fails and rolls
  // the marker back, no other caller has already been told it succeeded.
  const acquire = await deps.beginDispatch(
    {
      target_type: 'artifact_publish',
      target_id: cmd.artifactId,
      decision: 'approved',
      reviewer: cmd.reviewer,
      notes: cmd.notes ?? `${cmd.channel}_publish`,
    },
    `artifact_publish:${cmd.artifactId}:${cmd.channel}`,
  );
  if (acquire.kind === 'completed') {
    return { status: 200, body: { published: true, destination: cmd.channel, idempotent: true } };
  }
  if (acquire.kind === 'in_flight') {
    // A concurrent request is mid-dispatch — never claim success on its behalf.
    return {
      status: 409,
      body: {
        error: `a publish to ${cmd.channel} for this artifact is already in progress; refresh to see its result before retrying`,
        inFlight: true,
      },
    };
  }
  const approvalId = acquire.id;

  try {
    const result = await deps.dispatch(post);
    // Phase 2: only now is the send real — mark the marker completed so a later replay is idempotent.
    await deps.completeDispatch(approvalId);
    return { status: 200, body: { published: true, dryRun: false, destination: cmd.channel, url: result.url } };
  } catch {
    // The outward call failed — clear the pending marker so a retry can proceed, then report 502.
    let dedupeCleared = true;
    await deps.deleteApproval(approvalId).catch((e: unknown) => {
      // The clear ALSO failed: the marker is stuck 'pending', so every retry now resolves to a
      // permanent 'in_flight' 409 (never a false success, but never progressing either). Surface
      // this distinctly (500 + retryBlocked) instead of a 502 "retry me", so the UI does not invite
      // a retry that can never complete, and alerting can fire — an operator must delete the row.
      dedupeCleared = false;
      console.error('failed to clear publish dedupe marker; retry will be blocked', {
        channel: cmd.channel,
        artifactId: cmd.artifactId,
        message: e instanceof Error ? e.message : String(e),
      });
    });
    if (!dedupeCleared) {
      return {
        status: 500,
        body: {
          error: `publishing to ${cmd.channel} failed and the retry guard is stuck; an operator must clear it before retrying`,
          retryBlocked: true,
        },
      };
    }
    return { status: 502, body: { error: `publishing to ${cmd.channel} failed; check the server logs and retry` } };
  }
}
