// UX review R9 — unit coverage for the synthetic-run detector. A run is synthetic iff its
// langgraph_thread_id carries the demo seeder's `demo-` prefix; hasSyntheticRun is the any-of.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSyntheticRun, hasSyntheticRun } from '../app/lib/syntheticRun.ts';

test('a run with a demo- thread id is synthetic', () => {
  assert.equal(isSyntheticRun({ langgraph_thread_id: 'demo-abc123' }), true);
});

test('a real run (non-demo or null thread id) is not synthetic', () => {
  assert.equal(isSyntheticRun({ langgraph_thread_id: 'lg_run_release_intelligence' }), false);
  assert.equal(isSyntheticRun({ langgraph_thread_id: null }), false);
});

test('hasSyntheticRun is true iff any run is synthetic', () => {
  assert.equal(
    hasSyntheticRun([{ langgraph_thread_id: 'lg_x' }, { langgraph_thread_id: 'demo-y' }]),
    true,
  );
  assert.equal(hasSyntheticRun([{ langgraph_thread_id: 'lg_x' }]), false);
  assert.equal(hasSyntheticRun([]), false);
});
