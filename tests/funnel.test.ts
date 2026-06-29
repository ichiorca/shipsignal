// UX review R10 — unit coverage for the conversion-funnel shaping: stage order, bar width relative
// to the top stage, stage-over-stage conversion, and the divide-by-zero / empty guards.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFunnel, funnelIsEmpty } from '../app/lib/funnel.ts';

test('buildFunnel orders stages and computes width vs the top stage', () => {
  const stages = buildFunnel({ generated: 20, approved: 10, published: 5, engaged: 2 });
  assert.deepEqual(
    stages.map((s) => s.key),
    ['generated', 'approved', 'published', 'engaged'],
  );
  assert.deepEqual(
    stages.map((s) => s.count),
    [20, 10, 5, 2],
  );
  // pctOfTop: relative to generated (20).
  assert.deepEqual(
    stages.map((s) => s.pctOfTop),
    [100, 50, 25, 10],
  );
});

test('stepPct is the conversion from the previous stage, null for the first', () => {
  const stages = buildFunnel({ generated: 20, approved: 10, published: 5, engaged: 1 });
  assert.equal(stages[0]!.stepPct, null);
  assert.equal(stages[1]!.stepPct, 50); // 10/20
  assert.equal(stages[2]!.stepPct, 50); // 5/10
  assert.equal(stages[3]!.stepPct, 20); // 1/5
});

test('a zero top stage never divides by zero', () => {
  const stages = buildFunnel({ generated: 0, approved: 0, published: 0, engaged: 0 });
  assert.deepEqual(
    stages.map((s) => s.pctOfTop),
    [0, 0, 0, 0],
  );
  assert.equal(stages[1]!.stepPct, 0);
});

test('funnelIsEmpty is true only when nothing has been generated', () => {
  assert.equal(funnelIsEmpty({ generated: 0, approved: 0, published: 0, engaged: 0 }), true);
  assert.equal(funnelIsEmpty({ generated: 1, approved: 0, published: 0, engaged: 0 }), false);
});
