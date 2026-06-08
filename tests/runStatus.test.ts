// T1 (spec 015) — AC: the release status type supports all 12 §13.2 states and
// transitions are validated. This is the state machine the worker and dashboard share.
// Supersedes the spec-001 4-state assertions (queued/running/...).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RUN_STATUSES,
  canTransition,
  assertTransition,
  isTerminal,
  isRunStatus,
  progressIndex,
  InvalidStatusTransitionError,
} from '../app/lib/runStatus.ts';

test('all 12 PRD §13.2 states are present', () => {
  assert.deepEqual(
    [...RUN_STATUSES],
    [
      'created',
      'collecting_evidence',
      'evidence_ready',
      'features_pending_review',
      'features_approved',
      'generating_artifacts',
      'artifacts_pending_review',
      'artifacts_approved',
      'generating_media',
      'completed',
      'failed',
      'cancelled',
    ],
  );
});

test('the full happy path is legal one step at a time', () => {
  const path = RUN_STATUSES.filter((s) => s !== 'failed' && s !== 'cancelled');
  for (let i = 0; i < path.length - 1; i++) {
    assert.equal(
      canTransition(path[i]!, path[i + 1]!),
      true,
      `${path[i]} -> ${path[i + 1]} should be legal`,
    );
  }
  assert.equal(assertTransition('evidence_ready', 'features_pending_review'), 'features_pending_review');
});

test('artifacts_approved may skip media straight to completed', () => {
  assert.equal(canTransition('artifacts_approved', 'completed'), true);
  assert.equal(canTransition('artifacts_approved', 'generating_media'), true);
});

test('failure and cancellation are reachable from any non-terminal state', () => {
  for (const status of RUN_STATUSES) {
    if (isTerminal(status)) continue;
    assert.equal(canTransition(status, 'failed'), true, `${status} -> failed`);
    assert.equal(canTransition(status, 'cancelled'), true, `${status} -> cancelled`);
  }
});

test('steps cannot be skipped and terminals are final', () => {
  assert.equal(canTransition('created', 'completed'), false, 'cannot jump to completed');
  assert.equal(canTransition('created', 'evidence_ready'), false, 'cannot skip a step');
  assert.equal(canTransition('completed', 'generating_media'), false, 'terminal is final');
  assert.equal(canTransition('failed', 'created'), false);
  assert.equal(canTransition('cancelled', 'completed'), false);
});

test('assertTransition throws InvalidStatusTransitionError on an illegal move', () => {
  assert.throws(
    () => assertTransition('created', 'completed'),
    (err: unknown) =>
      err instanceof InvalidStatusTransitionError && err.from === 'created' && err.to === 'completed',
  );
});

test('completed/failed/cancelled are terminal; the rest are not', () => {
  assert.equal(isTerminal('completed'), true);
  assert.equal(isTerminal('failed'), true);
  assert.equal(isTerminal('cancelled'), true);
  assert.equal(isTerminal('created'), false);
  assert.equal(isTerminal('features_pending_review'), false);
  assert.equal(isTerminal('generating_media'), false);
});

test('progressIndex orders the happy path and excludes off-path terminals', () => {
  assert.equal(progressIndex('created'), 0);
  assert.equal(progressIndex('completed'), 9);
  assert.ok(progressIndex('features_approved')! > progressIndex('evidence_ready')!);
  assert.equal(progressIndex('failed'), null);
  assert.equal(progressIndex('cancelled'), null);
});

test('isRunStatus guards unknown DB values', () => {
  assert.equal(isRunStatus('collecting_evidence'), true);
  assert.equal(isRunStatus('queued'), false, 'the old skeleton state is no longer valid');
  assert.equal(isRunStatus('running'), false);
  assert.equal(isRunStatus(42), false);
});
