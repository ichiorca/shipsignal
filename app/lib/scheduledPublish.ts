// Path B / Phase 4 — pure scheduling logic for approve-then-schedule. DOM-free and server-only-free
// (mirrors cost.ts / evalMetrics.ts) so the UI, the routes, and the unit tests share one
// definition of "is this due?" and "what's a good time?" without dragging in the DB client.
//
// "Ship when your audience is awake" v1: a configurable default window (a weekday hour in UTC).
// v2 (later) can learn the window from the engagement metrics already collected. Everything takes
// an injected `now`, so the output is deterministic under test.

/** A scheduled publish lifecycle status (mirrors the DB CHECK; 'sending' added in migration 0028 —
 *  the drain claims a row to 'sending' before dispatch so a crash can't re-publish it). */
export type ScheduleStatus = 'pending' | 'sending' | 'sent' | 'failed' | 'cancelled';

export const SCHEDULE_STATUSES: readonly ScheduleStatus[] = [
  'pending',
  'sending',
  'sent',
  'failed',
  'cancelled',
];

export function isScheduleStatus(value: string): value is ScheduleStatus {
  return (SCHEDULE_STATUSES as readonly string[]).includes(value);
}

/** The channels a post can be scheduled to (Hacker News is assisted-only, so never scheduled). */
export type ScheduleChannel = 'linkedin' | 'x';

/** One scheduled_publishes row as the dashboard/UI render it (metadata only — no payload/token). */
export interface ScheduledPublishView {
  readonly id: string;
  readonly artifact_id: string;
  readonly release_run_id: string;
  readonly channel: ScheduleChannel;
  readonly scheduled_at: string;
  readonly status: ScheduleStatus;
  readonly attempt_count: number;
  readonly last_error: string | null;
  readonly published_url: string | null;
}

/** The default "audience awake" window: 15:00 UTC (a broad EU-afternoon / US-morning overlap). */
export const DEFAULT_WINDOW_HOUR_UTC = 15;

/** True when a pending row's scheduled time has arrived (≤ now). Equality counts as due. */
export function isDue(scheduledAtIso: string, now: Date): boolean {
  const at = new Date(scheduledAtIso);
  if (Number.isNaN(at.getTime())) return false;
  return at.getTime() <= now.getTime();
}

/** Suggest the next good publish window: the next occurrence of `hourUtc` that is in the future,
 *  skipping Saturday/Sunday (a weekday-only default). Returned as an ISO string. */
export function suggestNextWindow(
  now: Date,
  hourUtc: number = DEFAULT_WINDOW_HOUR_UTC,
): string {
  const candidate = new Date(now.getTime());
  candidate.setUTCMinutes(0, 0, 0);
  candidate.setUTCHours(hourUtc);
  // If today's window has already passed (or is now), move to tomorrow.
  if (candidate.getTime() <= now.getTime()) {
    candidate.setUTCDate(candidate.getUTCDate() + 1);
  }
  // Skip the weekend (0 = Sunday, 6 = Saturday).
  while (candidate.getUTCDay() === 0 || candidate.getUTCDay() === 6) {
    candidate.setUTCDate(candidate.getUTCDate() + 1);
  }
  return candidate.toISOString();
}

/** Validate a requested schedule time: it must parse and be in the future (a schedule in the past
 *  would fire on the very next drain, which is just "publish now" — reject so the UI is honest). */
export function validateScheduleTime(
  scheduledAtIso: string,
  now: Date,
): { readonly ok: true; readonly iso: string } | { readonly ok: false; readonly error: string } {
  const at = new Date(scheduledAtIso);
  if (Number.isNaN(at.getTime())) {
    return { ok: false, error: 'scheduled time is not a valid date' };
  }
  if (at.getTime() <= now.getTime()) {
    return { ok: false, error: 'scheduled time must be in the future' };
  }
  return { ok: true, iso: at.toISOString() };
}
