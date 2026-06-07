// T2/T5 (spec 001) — AC: status transitions queued→running→completed; illegal
// transitions are rejected. This is the state machine the worker and dashboard share.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canTransition,
  assertTransition,
  isTerminal,
  isRunStatus,
  InvalidStatusTransitionError,
} from '../app/lib/runStatus.ts';

test('the happy path queued→running→completed is legal', () => {
  assert.equal(canTransition('queued', 'running'), true);
  assert.equal(canTransition('running', 'completed'), true);
  assert.equal(assertTransition('running', 'completed'), 'completed');
});

test('failure is reachable from queued and running', () => {
  assert.equal(canTransition('queued', 'failed'), true);
  assert.equal(canTransition('running', 'failed'), true);
});

test('illegal transitions are rejected', () => {
  assert.equal(canTransition('queued', 'completed'), false, 'cannot skip running');
  assert.equal(canTransition('completed', 'running'), false, 'terminal is final');
  assert.equal(canTransition('failed', 'completed'), false);
});

test('assertTransition throws InvalidStatusTransitionError on an illegal move', () => {
  assert.throws(
    () => assertTransition('queued', 'completed'),
    (err: unknown) => err instanceof InvalidStatusTransitionError,
  );
});

test('completed and failed are terminal; queued and running are not', () => {
  assert.equal(isTerminal('completed'), true);
  assert.equal(isTerminal('failed'), true);
  assert.equal(isTerminal('queued'), false);
  assert.equal(isTerminal('running'), false);
});

test('isRunStatus guards unknown DB values', () => {
  assert.equal(isRunStatus('running'), true);
  assert.equal(isRunStatus('collecting_evidence'), false);
  assert.equal(isRunStatus(42), false);
});
