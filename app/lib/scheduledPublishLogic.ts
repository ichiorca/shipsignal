// Path B / Phase 4 — the scheduled-publish DRAIN logic, extracted from the runner so it is unit-
// testable without a DB, network, or server-only. The runner (scheduledPublishRunner.ts) injects
// the real Aurora reads/writes + the Phase-3 dispatch. The interesting behavior — re-verifying the
// live approval before sending, marking each row sent/failed, dry-run counting, and one bad row
// never blocking the batch — lives here and is covered by tests/scheduledPublishLogic.test.ts.

import { timingSafeEqual } from 'node:crypto';
import type { ScheduledPublishView, ScheduleChannel } from './scheduledPublish.ts';
import type { ApprovedSnapshotView } from './artifactExport.ts';
import type { ChannelPublishResult } from './channelDispatch.ts';

export interface DrainSummary {
  readonly processed: number;
  readonly sent: number;
  readonly failed: number;
  readonly dryRun: number;
}

/** Authorize the cron drain endpoint from its Authorization header + the configured secret.
 *  'disabled' (secret unset → the route 503s, feature off) · 'unauthorized' (missing/wrong bearer
 *  → 401) · 'ok'. Pure so the security gate is unit-testable without next/server. */
export function drainAuthDecision(
  authHeader: string | null,
  secret: string,
): 'disabled' | 'unauthorized' | 'ok' {
  if (secret === '') return 'disabled';
  const h = authHeader ?? '';
  const bearer = h.startsWith('Bearer ') ? h.slice('Bearer '.length) : '';
  if (bearer === '') return 'unauthorized';
  // Constant-time compare so the endpoint can't leak the secret's length/prefix via timing (the
  // GitHub webhook handler uses timingSafeEqual for the same reason). Length-guard first since
  // timingSafeEqual throws on unequal-length buffers.
  const provided = Buffer.from(bearer, 'utf8');
  const expected = Buffer.from(secret, 'utf8');
  const ok = provided.length === expected.length && timingSafeEqual(provided, expected);
  return ok ? 'ok' : 'unauthorized';
}

export interface DrainDeps {
  /** Atomically CLAIM due rows (pending → sending) so a crash can't re-publish them. */
  readonly claimDue: (nowIso: string, limit: number) => Promise<readonly ScheduledPublishView[]>;
  readonly getSnapshot: (artifactId: string) => Promise<ApprovedSnapshotView | null>;
  /** The artifact's CURRENT status (to re-verify it is still approved at send time). */
  readonly getStatus: (artifactId: string) => Promise<string | null>;
  readonly publish: (channel: ScheduleChannel, snapshot: ApprovedSnapshotView) => Promise<ChannelPublishResult>;
  readonly markSent: (id: string, url: string | null) => Promise<void>;
  readonly markFailed: (id: string, error: string) => Promise<void>;
}

/** Drain due schedules. Each row is CLAIMED (pending → sending) before any send, so a crash can't
 *  re-publish it. Before dispatch the row's artifact is re-verified to be STILL approved at Gate #2
 *  — an artifact rejected or edited after scheduling FAILS instead of shipping stale/un-approved
 *  content (constitution §5). A dispatch throw fails just that row; the batch continues. Rows run
 *  concurrently (each row's writes are id-targeted, so parallelism is safe). */
export async function drainDueSchedules(
  now: Date,
  limit: number,
  deps: DrainDeps,
): Promise<DrainSummary> {
  const claimed = await deps.claimDue(now.toISOString(), limit);
  let sent = 0;
  let failed = 0;
  let dryRun = 0;

  const outcomes = await Promise.all(
    claimed.map(async (row): Promise<'sent' | 'failed' | 'dry'> => {
      // Re-verify the LIVE approval state: the immutable snapshot persists even after a reject/edit,
      // so checking the snapshot alone is not enough — confirm the artifact is still 'approved'.
      const status = await deps.getStatus(row.artifact_id);
      if (status !== 'approved') {
        await deps.markFailed(row.id, `artifact is no longer approved at Gate #2 (status: ${status ?? 'missing'})`);
        return 'failed';
      }
      const snapshot = await deps.getSnapshot(row.artifact_id);
      if (snapshot === null) {
        await deps.markFailed(row.id, 'approved snapshot is missing');
        return 'failed';
      }
      try {
        const result = await deps.publish(row.channel, snapshot);
        await deps.markSent(row.id, result.url);
        return result.dryRun ? 'dry' : 'sent';
      } catch (err) {
        await deps.markFailed(row.id, `publish failed: ${String(err)}`.slice(0, 500));
        return 'failed';
      }
    }),
  );

  for (const o of outcomes) {
    if (o === 'failed') failed += 1;
    else {
      sent += 1;
      if (o === 'dry') dryRun += 1;
    }
  }
  return { processed: claimed.length, sent, failed, dryRun };
}
