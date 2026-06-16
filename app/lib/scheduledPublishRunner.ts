// Path B / Phase 4 — the drain: publish due, still-approved scheduled posts. Invoked by the
// GitHub Actions cron (the sanctioned long-job runner; constitution §1/§2 — no Step Functions /
// EventBridge / bespoke scheduler). Reuses the Phase-3 build + dispatch, so a scheduled send goes
// out exactly like a manual one (dry-run when a channel is unconfigured).
//
// Safety: each row is re-checked against the live approved snapshot before sending — if the
// artifact is no longer approved (e.g. superseded), the row fails instead of shipping stale
// content (§5: nothing publishes without a current Gate #2 approval). One failed row never blocks
// the rest of the batch.

import 'server-only';
import { claimDuePending, markScheduleSent, markScheduleFailed } from '@/app/lib/db/scheduledPublishes.ts';
import { getApprovedSnapshotForArtifact } from '@/app/lib/db/approvedSnapshots.ts';
import { getArtifactStatus } from '@/app/lib/db/claims.ts';
import { buildXPost, buildLinkedInPost } from '@/app/lib/channelPublish.ts';
import { publishToX, publishToLinkedIn } from '@/app/lib/channelDispatch.ts';
import { drainDueSchedules, type DrainSummary } from '@/app/lib/scheduledPublishLogic.ts';
import type { ScheduleChannel } from '@/app/lib/scheduledPublish.ts';
import type { ApprovedSnapshotView } from '@/app/lib/artifactExport.ts';

export type { DrainSummary } from '@/app/lib/scheduledPublishLogic.ts';

const DISPATCH: Record<
  ScheduleChannel,
  { build: (s: ApprovedSnapshotView) => { text: string }; send: (p: { text: string }) => ReturnType<typeof publishToX> }
> = {
  x: { build: buildXPost, send: publishToX },
  linkedin: { build: buildLinkedInPost, send: publishToLinkedIn },
};

/** Drain due+pending schedules by wiring the real Aurora + Phase-3 dispatch into the (unit-tested)
 *  drain logic. */
export async function runDueSchedules(now: Date, limit = 25): Promise<DrainSummary> {
  return drainDueSchedules(now, limit, {
    claimDue: claimDuePending,
    getSnapshot: getApprovedSnapshotForArtifact,
    getStatus: getArtifactStatus,
    publish: (channel, snapshot) => {
      const { build, send } = DISPATCH[channel];
      return send(build(snapshot));
    },
    markSent: markScheduleSent,
    markFailed: markScheduleFailed,
  });
}
