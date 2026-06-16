// UI tier-1/2 — the pure run-progress logic that drives the review queue, the pipeline stepper,
// and the action-oriented run list. Pure functions, so unit-tested directly.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  nextStep,
  isAwaitingReview,
  statusCategory,
  buildPipeline,
} from '../app/lib/runProgress.ts';
import type { ReleaseRun } from '../app/lib/db/releaseRuns.ts';
import type { RunStatus } from '../app/lib/runStatus.ts';

function run(status: RunStatus): ReleaseRun {
  return {
    id: 'aaaaaaaa-1111-2222-3333-444444444444',
    repo: 'org/product',
    base_ref: 'v1.0',
    head_ref: 'v1.1',
    trigger_type: 'manual',
    status,
    artifact_types: ['release_blog'],
    langgraph_thread_id: null,
    started_at: '2026-06-07T10:00:00.000Z',
    completed_at: null,
  };
}

test('nextStep points at the gate the run is halted at, else null', () => {
  assert.deepEqual(nextStep(run('features_pending_review')), {
    label: 'Review the feature manifest (Gate #1)',
    href: '/releases/aaaaaaaa-1111-2222-3333-444444444444/review',
  });
  assert.equal(nextStep(run('artifacts_pending_review'))?.href.endsWith('/artifacts/review'), true);
  assert.equal(nextStep(run('generating_artifacts')), null);
  assert.equal(nextStep(run('completed')), null);
  assert.equal(isAwaitingReview(run('features_pending_review')), true);
  assert.equal(isAwaitingReview(run('completed')), false);
});

test('statusCategory collapses the lattice into four buckets', () => {
  assert.equal(statusCategory('features_pending_review'), 'awaiting');
  assert.equal(statusCategory('artifacts_pending_review'), 'awaiting');
  assert.equal(statusCategory('completed'), 'done');
  assert.equal(statusCategory('failed'), 'failed');
  assert.equal(statusCategory('cancelled'), 'failed');
  assert.equal(statusCategory('collecting_evidence'), 'in_progress');
  assert.equal(statusCategory('artifacts_approved'), 'in_progress');
});

test('buildPipeline marks done / awaiting / upcoming relative to the run position', () => {
  const states = Object.fromEntries(
    buildPipeline(run('artifacts_pending_review')).map((s) => [s.key, s.state]),
  );
  assert.deepEqual(states, {
    evidence: 'done',
    gate1: 'done',
    artifacts: 'done',
    gate2: 'awaiting',
    media: 'upcoming',
    complete: 'upcoming',
  });
});

test('buildPipeline links only reachable stages (no dead links to future screens)', () => {
  const stages = buildPipeline(run('features_pending_review'));
  const gate1 = stages.find((s) => s.key === 'gate1');
  const media = stages.find((s) => s.key === 'media');
  assert.equal(gate1?.state, 'awaiting');
  assert.equal(gate1?.href, '/releases/aaaaaaaa-1111-2222-3333-444444444444/review');
  assert.equal(media?.state, 'upcoming');
  assert.equal(media?.href, null, 'an upcoming stage exposes no link');
});

test('a completed run shows every stage done — never the Complete stage "in progress"', () => {
  const states = Object.fromEntries(buildPipeline(run('completed')).map((s) => [s.key, s.state]));
  assert.ok(
    Object.values(states).every((s) => s === 'done'),
    `every stage done for a completed run, got ${JSON.stringify(states)}`,
  );
});

test('a passed gate reads "done", not "in progress", once its decision is recorded', () => {
  // features_approved: Gate #1 is decided → it must be done, and artifact generation is current.
  const afterGate1 = Object.fromEntries(
    buildPipeline(run('features_approved')).map((s) => [s.key, s.state]),
  );
  assert.equal(afterGate1.gate1, 'done');
  assert.equal(afterGate1.artifacts, 'current');
  // artifacts_approved: Gate #2 is decided → done, and media is the active stage.
  const afterGate2 = Object.fromEntries(
    buildPipeline(run('artifacts_approved')).map((s) => [s.key, s.state]),
  );
  assert.equal(afterGate2.gate2, 'done');
  assert.equal(afterGate2.media, 'current');
});

test('a failed/cancelled run renders the whole pipeline as halted (position is lost)', () => {
  for (const status of ['failed', 'cancelled'] as const) {
    const stages = buildPipeline(run(status));
    assert.ok(stages.every((s) => s.state === 'halted'), `${status} → all halted`);
    assert.ok(stages.every((s) => s.href === null), `${status} → no links`);
  }
});
