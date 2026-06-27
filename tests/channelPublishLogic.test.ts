// Path B / Phase 3 — route-logic coverage for channel publishing, with injected fakes (no DB,
// network, or server-only). Exercises every branch the LinkedIn/X routes rely on: the approved-
// snapshot gate (404 vs 409), the wrong-channel gate, the dry-run-vs-real split, per-destination
// idempotency, and the delete-on-failure rollback.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decideChannelPublish,
  type ChannelPublishDeps,
} from '../app/lib/channelPublishLogic.ts';
import type { ApprovedSnapshotView } from '../app/lib/artifactExport.ts';

function snapshot(type: string): ApprovedSnapshotView {
  return {
    artifact_id: 'art-1',
    release_run_id: 'run-1',
    approval_id: 'appr-1',
    artifact_type: type,
    model_id: null,
    prompt_version: null,
    skill_versions: {},
    evidence_ids: [],
    claim_support: [],
    reviewer_decision: 'approved',
    final_title: 'T',
    final_body_markdown: 'Ship it.',
    content_hash: 'h',
    generated_at: null,
    approved_at: null,
  };
}

interface Spy {
  recordCalls: number;
  completeCalls: string[];
  deleteCalls: string[];
  dispatchCalls: number;
}

function deps(overrides: Partial<ChannelPublishDeps>, spy: Spy): ChannelPublishDeps {
  return {
    getSnapshot: async () => snapshot('x_post'),
    getArtifactStatus: async () => 'approved',
    beginDispatch: async () => {
      spy.recordCalls += 1;
      return { kind: 'acquired', id: 'approval-1' };
    },
    completeDispatch: async (id) => {
      spy.completeCalls.push(id);
    },
    deleteApproval: async (id) => {
      spy.deleteCalls.push(id);
    },
    willDryRun: () => false,
    isPublishable: (t) => t === 'x_post',
    build: () => ({ text: 'Ship it.' }),
    dispatch: async () => {
      spy.dispatchCalls += 1;
      return { channel: 'x', dryRun: false, url: 'https://x.com/i/web/status/1' };
    },
    ...overrides,
  };
}

function newSpy(): Spy {
  return { recordCalls: 0, completeCalls: [], deleteCalls: [], dispatchCalls: 0 };
}

const cmd = { artifactId: 'art-1', channel: 'x' as const, reviewer: 'Dana' };

test('unknown artifact → 404', async () => {
  const spy = newSpy();
  const r = await decideChannelPublish(cmd, deps({ getSnapshot: async () => null, getArtifactStatus: async () => null }, spy));
  assert.equal(r.status, 404);
});

test('not-approved artifact → 409 with its status', async () => {
  const spy = newSpy();
  const r = await decideChannelPublish(cmd, deps({ getSnapshot: async () => null, getArtifactStatus: async () => 'draft' }, spy));
  assert.equal(r.status, 409);
  assert.equal(r.body.status, 'draft');
});

test('wrong channel for the artifact type → 409', async () => {
  const spy = newSpy();
  const r = await decideChannelPublish(cmd, deps({ getSnapshot: async () => snapshot('linkedin_post') }, spy));
  assert.equal(r.status, 409);
});

test('dry-run → 200 preview, and NO approval/idempotency recorded', async () => {
  const spy = newSpy();
  const r = await decideChannelPublish(
    cmd,
    deps({ willDryRun: () => true, dispatch: async () => ({ channel: 'x', dryRun: true, url: null }) }, spy),
  );
  assert.equal(r.status, 200);
  assert.equal(r.body.dryRun, true);
  assert.equal(r.body.preview, 'Ship it.');
  assert.equal(spy.recordCalls, 0, 'a dry-run must not record an approval (re-runnable)');
});

test('real send success → 200 published, marker completed (phase 2), not rolled back', async () => {
  const spy = newSpy();
  const r = await decideChannelPublish(cmd, deps({}, spy));
  assert.equal(r.status, 200);
  assert.equal(r.body.published, true);
  assert.equal(r.body.url, 'https://x.com/i/web/status/1');
  assert.equal(spy.recordCalls, 1);
  assert.deepEqual(spy.completeCalls, ['approval-1'], 'a successful send marks the marker completed');
  assert.deepEqual(spy.deleteCalls, []);
});

test('already completed (idempotent replay) → 200 idempotent, dispatch NOT called', async () => {
  const spy = newSpy();
  const r = await decideChannelPublish(cmd, deps({ beginDispatch: async () => ({ kind: 'completed' }) }, spy));
  assert.equal(r.status, 200);
  assert.equal(r.body.idempotent, true);
  assert.equal(spy.dispatchCalls, 0, 'an already-delivered artifact must not re-dispatch');
});

test('concurrent send in flight → 409 inFlight, never a false published', async () => {
  const spy = newSpy();
  const r = await decideChannelPublish(cmd, deps({ beginDispatch: async () => ({ kind: 'in_flight' }) }, spy));
  assert.equal(r.status, 409);
  assert.equal(r.body.inFlight, true);
  assert.notEqual(r.body.published, true, 'a mid-flight concurrent publish must not be reported as success');
  assert.equal(spy.dispatchCalls, 0, 'the concurrent caller must not dispatch a second send');
});

test('dispatch failure → 502 and the pending marker is rolled back', async () => {
  const spy = newSpy();
  const r = await decideChannelPublish(
    cmd,
    deps({ dispatch: async () => { throw new Error('upstream 500'); } }, spy),
  );
  assert.equal(r.status, 502);
  assert.deepEqual(spy.completeCalls, [], 'a failed send must not mark the marker completed');
  assert.deepEqual(spy.deleteCalls, ['approval-1'], 'the dedupe marker is cleared so a retry can proceed');
});
