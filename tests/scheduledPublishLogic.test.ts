// Path B / Phase 4 — drain-logic coverage with injected fakes (no DB / network / server-only).
// Exercises the cron drain: re-verify approval before sending, mark each row sent/failed, count
// dry-runs, and ensure one bad row never blocks the batch.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drainDueSchedules, drainAuthDecision, type DrainDeps } from '../app/lib/scheduledPublishLogic.ts';
import type { ScheduledPublishView } from '../app/lib/scheduledPublish.ts';
import type { ApprovedSnapshotView } from '../app/lib/artifactExport.ts';

function due(id: string, artifactId: string): ScheduledPublishView {
  return {
    id,
    artifact_id: artifactId,
    release_run_id: 'run-1',
    channel: 'x',
    scheduled_at: '2026-06-15T12:00:00.000Z',
    status: 'pending',
    attempt_count: 0,
    last_error: null,
    published_url: null,
  };
}

function snapshot(): ApprovedSnapshotView {
  return {
    artifact_id: 'a', release_run_id: 'run-1', approval_id: null, artifact_type: 'x_post',
    model_id: null, prompt_version: null, skill_versions: {}, evidence_ids: [], claim_support: [],
    reviewer_decision: 'approved', final_title: null, final_body_markdown: 'Ship.', content_hash: 'h',
    generated_at: null, approved_at: null,
  };
}

interface Marks {
  sent: string[];
  failed: { id: string; error: string }[];
}

function deps(overrides: Partial<DrainDeps>, marks: Marks): DrainDeps {
  return {
    claimDue: async () => [due('s1', 'a1'), due('s2', 'a2')],
    getSnapshot: async () => snapshot(),
    getStatus: async () => 'approved',
    publish: async () => ({ channel: 'x', dryRun: false, url: 'https://x.com/1' }),
    markSent: async (id) => { marks.sent.push(id); },
    markFailed: async (id, error) => { marks.failed.push({ id, error }); },
    ...overrides,
  };
}

const NOW = new Date('2026-06-15T12:30:00.000Z');

test('all due rows sent → summary counts them', async () => {
  const marks: Marks = { sent: [], failed: [] };
  const summary = await drainDueSchedules(NOW, 25, deps({}, marks));
  assert.deepEqual(summary, { processed: 2, sent: 2, failed: 0, dryRun: 0 });
  assert.deepEqual(marks.sent, ['s1', 's2']);
});

test('a row whose artifact was REJECTED/EDITED after scheduling FAILS (never ships stale content)', async () => {
  const marks: Marks = { sent: [], failed: [] };
  // a2 was rejected after it was scheduled — its immutable snapshot still exists, but the live
  // status is no longer 'approved', so the drain must NOT publish it.
  const summary = await drainDueSchedules(
    NOW,
    25,
    deps({ getStatus: async (artifactId) => (artifactId === 'a2' ? 'rejected' : 'approved') }, marks),
  );
  assert.equal(summary.sent, 1);
  assert.equal(summary.failed, 1);
  assert.equal(marks.sent[0], 's1');
  assert.match(marks.failed.find((f) => f.id === 's2')?.error ?? '', /no longer approved/);
});

test('a missing approved snapshot FAILS the row', async () => {
  const marks: Marks = { sent: [], failed: [] };
  const summary = await drainDueSchedules(NOW, 25, deps({ getSnapshot: async () => null }, marks));
  assert.equal(summary.sent, 0);
  assert.equal(summary.failed, 2);
});

test('a dispatch throw fails only that row; the batch continues', async () => {
  const marks: Marks = { sent: [], failed: [] };
  let call = 0;
  const summary = await drainDueSchedules(
    NOW,
    25,
    deps({
      publish: async () => {
        call += 1;
        if (call === 1) throw new Error('rate limited');
        return { channel: 'x', dryRun: false, url: null };
      },
    }, marks),
  );
  assert.equal(summary.processed, 2);
  assert.equal(summary.failed, 1);
  assert.equal(summary.sent, 1);
});

test('dry-run sends are counted', async () => {
  const marks: Marks = { sent: [], failed: [] };
  const summary = await drainDueSchedules(
    NOW,
    25,
    deps({ publish: async () => ({ channel: 'x', dryRun: true, url: null }) }, marks),
  );
  assert.equal(summary.sent, 2);
  assert.equal(summary.dryRun, 2);
});

test('no due rows → all zeros', async () => {
  const marks: Marks = { sent: [], failed: [] };
  const summary = await drainDueSchedules(NOW, 25, deps({ claimDue: async () => [] }, marks));
  assert.deepEqual(summary, { processed: 0, sent: 0, failed: 0, dryRun: 0 });
});

test('drain auth gate: unset secret disabled; wrong/missing bearer unauthorized; match ok', () => {
  assert.equal(drainAuthDecision('Bearer anything', ''), 'disabled');
  assert.equal(drainAuthDecision(null, 's3cr3t'), 'unauthorized');
  assert.equal(drainAuthDecision('s3cr3t', 's3cr3t'), 'unauthorized'); // missing "Bearer " prefix
  assert.equal(drainAuthDecision('Bearer wrong', 's3cr3t'), 'unauthorized');
  assert.equal(drainAuthDecision('Bearer s3cr3t', 's3cr3t'), 'ok');
});
