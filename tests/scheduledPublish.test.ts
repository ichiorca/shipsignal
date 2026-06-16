// Path B / Phase 4 — unit tests for the pure scheduling logic (due check, next-window suggestion,
// schedule-time validation). All take an injected `now`, so the assertions are deterministic.
// 2026-06-15 is a Monday; 06-19 Fri, 06-20 Sat, 06-21 Sun, 06-22 Mon (used for the weekend-skip).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isDue,
  suggestNextWindow,
  validateScheduleTime,
  isScheduleStatus,
} from '../app/lib/scheduledPublish.ts';

test('isDue: past and exactly-now are due; future is not; invalid is not', () => {
  const now = new Date('2026-06-15T12:00:00.000Z');
  assert.equal(isDue('2026-06-15T11:59:59.000Z', now), true);
  assert.equal(isDue('2026-06-15T12:00:00.000Z', now), true);
  assert.equal(isDue('2026-06-15T12:00:01.000Z', now), false);
  assert.equal(isDue('not-a-date', now), false);
});

test('suggestNextWindow: same-day window when it is still ahead', () => {
  // Monday 10:00 → today 15:00 UTC.
  assert.equal(
    suggestNextWindow(new Date('2026-06-15T10:00:00.000Z')),
    '2026-06-15T15:00:00.000Z',
  );
});

test('suggestNextWindow: rolls to tomorrow once the window has passed', () => {
  // Monday 16:00 → Tuesday 15:00 UTC.
  assert.equal(
    suggestNextWindow(new Date('2026-06-15T16:00:00.000Z')),
    '2026-06-16T15:00:00.000Z',
  );
});

test('suggestNextWindow: skips the weekend', () => {
  // Friday 16:00 → Sat/Sun skipped → Monday 15:00 UTC.
  assert.equal(
    suggestNextWindow(new Date('2026-06-19T16:00:00.000Z')),
    '2026-06-22T15:00:00.000Z',
  );
});

test('validateScheduleTime: future ok, past/invalid rejected', () => {
  const now = new Date('2026-06-15T12:00:00.000Z');
  const ok = validateScheduleTime('2026-06-15T18:00:00.000Z', now);
  assert.equal(ok.ok, true);
  assert.equal(ok.ok === true && ok.iso, '2026-06-15T18:00:00.000Z');

  assert.equal(validateScheduleTime('2026-06-15T06:00:00.000Z', now).ok, false);
  assert.equal(validateScheduleTime('nope', now).ok, false);
});

test('isScheduleStatus narrows the DB CHECK set', () => {
  for (const s of ['pending', 'sent', 'failed', 'cancelled']) {
    assert.equal(isScheduleStatus(s), true);
  }
  assert.equal(isScheduleStatus('queued'), false);
});
