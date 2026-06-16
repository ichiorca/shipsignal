// Path B / Phase 4 — scheduled_publishes repository (migration 0027): typed reads/writes for the
// approve-then-schedule queue. P5 (Safety rails) / constitution §2/§5: every query is parameterised
// and the rows carry METADATA only (channel, time, status, secret-free error, the approval_id that
// authorized it) — never a payload or token. One live schedule per (artifact, channel): scheduling
// upserts, so a re-schedule replaces rather than stacks.

import { query, type Queryable } from '@/app/lib/aurora.ts';
import {
  isScheduleStatus,
  type ScheduleChannel,
  type ScheduledPublishView,
} from '@/app/lib/scheduledPublish.ts';

interface RawRow {
  id: string;
  artifact_id: string;
  release_run_id: string;
  channel: string;
  scheduled_at: Date | string;
  status: string;
  attempt_count: string | number | null;
  last_error: string | null;
  published_url: string | null;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function mapRow(row: RawRow): ScheduledPublishView {
  if (!isScheduleStatus(row.status)) {
    throw new Error(`unexpected scheduled_publishes status in DB: ${row.status}`);
  }
  if (row.channel !== 'linkedin' && row.channel !== 'x') {
    throw new Error(`unexpected scheduled_publishes channel in DB: ${row.channel}`);
  }
  return {
    id: row.id,
    artifact_id: row.artifact_id,
    release_run_id: row.release_run_id,
    channel: row.channel,
    scheduled_at: toIso(row.scheduled_at),
    status: row.status,
    attempt_count: row.attempt_count === null ? 0 : Math.trunc(Number(row.attempt_count)),
    last_error: row.last_error,
    published_url: row.published_url,
  };
}

const COLUMNS =
  'id, artifact_id, release_run_id, channel, scheduled_at, status, attempt_count, last_error, published_url';

export interface ScheduleInput {
  readonly artifactId: string;
  readonly releaseRunId: string;
  readonly channel: ScheduleChannel;
  readonly scheduledAtIso: string;
  readonly approvalId: string | null;
}

/** Schedule (or re-schedule) a publish. Upsert on (artifact_id, channel): a new time resets the
 *  row to pending and clears any prior attempt/error, so re-scheduling a failed send retries it. */
export async function schedulePublish(
  input: ScheduleInput,
  db: Queryable = { query },
): Promise<ScheduledPublishView> {
  const result = await db.query<RawRow>(
    `INSERT INTO scheduled_publishes
       (artifact_id, release_run_id, channel, scheduled_at, status, approval_id)
     VALUES ($1, $2, $3, $4, 'pending', $5)
     ON CONFLICT (artifact_id, channel) DO UPDATE
       SET scheduled_at = EXCLUDED.scheduled_at,
           status        = 'pending',
           -- Keep the original authorizing approval when a re-schedule passes null (the human
           -- already approved at Gate #2; re-timing doesn't re-authorize or de-authorize).
           approval_id   = COALESCE(EXCLUDED.approval_id, scheduled_publishes.approval_id),
           attempt_count = 0,
           last_error    = NULL,
           published_url = NULL,
           updated_at    = now()
     RETURNING ${COLUMNS}`,
    [input.artifactId, input.releaseRunId, input.channel, input.scheduledAtIso, input.approvalId],
  );
  return mapRow(result.rows[0]!);
}

/** Due + pending rows for the cron drain (oldest scheduled first), bounded per invocation so a
 *  backlog can't fan out an unbounded number of channel calls in one run. Read-only; prefer
 *  claimDuePending in the drain (it claims atomically to prevent double-publish). */
export async function listDuePending(
  nowIso: string,
  limit = 25,
  db: Queryable = { query },
): Promise<readonly ScheduledPublishView[]> {
  const result = await db.query<RawRow>(
    `SELECT ${COLUMNS} FROM scheduled_publishes
      WHERE status = 'pending' AND scheduled_at <= $1
      ORDER BY scheduled_at ASC
      LIMIT $2`,
    [nowIso, limit],
  );
  return result.rows.map(mapRow);
}

/** Atomically CLAIM up to `limit` due rows (pending → sending) and return them. `FOR UPDATE SKIP
 *  LOCKED` lets the claim run concurrently without two drains grabbing the same row, and — more
 *  importantly — once a row is 'sending' it is never re-selected, so a crash after a successful
 *  POST can't re-publish it (at-most-once). The trade is a row possibly stuck 'sending' on crash
 *  (operator requeue), the safe direction for a public post. */
export async function claimDuePending(
  nowIso: string,
  limit = 25,
  db: Queryable = { query },
): Promise<readonly ScheduledPublishView[]> {
  const result = await db.query<RawRow>(
    `UPDATE scheduled_publishes SET status = 'sending', updated_at = now()
      WHERE id IN (
        SELECT id FROM scheduled_publishes
         WHERE status = 'pending' AND scheduled_at <= $1
         ORDER BY scheduled_at ASC
         LIMIT $2
         FOR UPDATE SKIP LOCKED
      )
      RETURNING ${COLUMNS}`,
    [nowIso, limit],
  );
  return result.rows.map(mapRow);
}

/** Reap rows wedged in 'sending' by a prior drain that crashed after claiming but before marking
 *  the row sent/failed (a Vercel/Actions kill, OOM, or hung channel call). After `staleMinutes`
 *  (well beyond a healthy drain), flip them to 'failed' so an operator can re-schedule — the slot
 *  is no longer blocked by the UNIQUE(artifact_id, channel) constraint. Marking 'failed' rather
 *  than re-claiming preserves at-most-once for a public post: a row that may already have been
 *  sent is never re-published; the operator decides whether to retry. Returns the count reaped. */
export async function expireStaleSending(
  staleMinutes = 30,
  db: Queryable = { query },
): Promise<number> {
  const result = await db.query<{ id: string }>(
    `UPDATE scheduled_publishes
        SET status = 'failed', attempt_count = attempt_count + 1,
            last_error = 'dispatch did not finish (worker stopped mid-send); re-schedule to retry',
            updated_at = now()
      WHERE status = 'sending'
        AND updated_at < now() - make_interval(mins => $1)
      RETURNING id`,
    [staleMinutes],
  );
  return result.rows.length;
}

/** Mark a CLAIMED row sent (terminal success), recording the live post URL when the channel
 *  returned one. Guarded on status='sending' so it only ever terminates a row this drain claimed. */
export async function markScheduleSent(
  id: string,
  publishedUrl: string | null,
  db: Queryable = { query },
): Promise<void> {
  await db.query(
    `UPDATE scheduled_publishes
        SET status = 'sent', attempt_count = attempt_count + 1,
            published_url = $2, last_error = NULL, updated_at = now()
      WHERE id = $1 AND status = 'sending'`,
    [id, publishedUrl],
  );
}

/** Mark a CLAIMED row failed (terminal for this drain), recording a secret-free error. A human can
 *  re-schedule it to retry (which resets it to pending). */
export async function markScheduleFailed(
  id: string,
  error: string,
  db: Queryable = { query },
): Promise<void> {
  await db.query(
    `UPDATE scheduled_publishes
        SET status = 'failed', attempt_count = attempt_count + 1,
            last_error = $2, updated_at = now()
      WHERE id = $1 AND status = 'sending'`,
    [id, error],
  );
}

/** Cancel ALL pending schedules for an artifact (both channels). Called when an approved artifact
 *  is rejected or edited (un-approved) so a queued post never ships stale content. Only 'pending'
 *  rows are cancellable; a row already claimed ('sending') is caught by the drain's live re-check. */
export async function cancelSchedulesForArtifact(
  artifactId: string,
  db: Queryable = { query },
): Promise<number> {
  const result = await db.query(
    `UPDATE scheduled_publishes SET status = 'cancelled', updated_at = now()
      WHERE artifact_id = $1 AND status = 'pending'`,
    [artifactId],
  );
  return result.rowCount ?? 0;
}

/** Cancel a still-pending schedule. Returns true iff a pending row was cancelled (a sent/failed/
 *  already-cancelled row matches nothing — you can't unsend). */
export async function cancelSchedule(id: string, db: Queryable = { query }): Promise<boolean> {
  const result = await db.query(
    `UPDATE scheduled_publishes SET status = 'cancelled', updated_at = now()
      WHERE id = $1 AND status = 'pending'`,
    [id],
  );
  return (result.rowCount ?? 0) > 0;
}

/** Cancel a still-pending schedule by its (artifact, channel) — the UI's unit (one row per pair).
 *  Returns true iff a pending row was cancelled. */
export async function cancelScheduleByArtifactChannel(
  artifactId: string,
  channel: ScheduleChannel,
  db: Queryable = { query },
): Promise<boolean> {
  const result = await db.query(
    `UPDATE scheduled_publishes SET status = 'cancelled', updated_at = now()
      WHERE artifact_id = $1 AND channel = $2 AND status = 'pending'`,
    [artifactId, channel],
  );
  return (result.rowCount ?? 0) > 0;
}

/** Upcoming + recent schedules for the Distribute queue (soonest pending first, then recent).
 *  Bounded to live rows (pending/sending/failed) plus the last 30 days of terminal history, so the
 *  scan doesn't grow unbounded with every sent/cancelled row ever created as the table accumulates. */
export async function listUpcomingSchedules(
  limit = 50,
  db: Queryable = { query },
): Promise<readonly ScheduledPublishView[]> {
  const result = await db.query<RawRow>(
    `SELECT ${COLUMNS} FROM scheduled_publishes
      WHERE status IN ('pending', 'sending', 'failed')
         OR scheduled_at >= now() - interval '30 days'
      ORDER BY (status = 'pending') DESC, scheduled_at ASC
      LIMIT $1`,
    [limit],
  );
  return result.rows.map(mapRow);
}

/** All schedules for a run's artifacts, for the Gate #2 review surface (so each approved post can
 *  be scheduled inline). The route groups these by artifact_id. */
export async function listSchedulesForRun(
  releaseRunId: string,
  db: Queryable = { query },
): Promise<readonly ScheduledPublishView[]> {
  const result = await db.query<RawRow>(
    // Bounded by UNIQUE(artifact_id, channel) to (types × channels) per run; LIMIT is a defensive
    // ceiling so a future schema change can't make this unbounded.
    `SELECT ${COLUMNS} FROM scheduled_publishes WHERE release_run_id = $1 ORDER BY channel ASC LIMIT 200`,
    [releaseRunId],
  );
  return result.rows.map(mapRow);
}

/** Schedules for one artifact (both channels), for the per-artifact schedule UI. */
export async function listSchedulesForArtifact(
  artifactId: string,
  db: Queryable = { query },
): Promise<readonly ScheduledPublishView[]> {
  const result = await db.query<RawRow>(
    `SELECT ${COLUMNS} FROM scheduled_publishes WHERE artifact_id = $1 ORDER BY channel ASC LIMIT 10`,
    [artifactId],
  );
  return result.rows.map(mapRow);
}
