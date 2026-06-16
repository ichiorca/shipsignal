// Operator feedback 2026-06-09 (priority 3) — the trend math: honest below two measured
// points, direction from first-half vs second-half means, null (unmeasured) runs skipped,
// and the decorative sparkline geometry stays in bounds.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  percentCell,
  sparklinePoints,
  summarizeTrend,
} from '../app/lib/learningTrends.ts';

test('fewer than two measured points is insufficient data, never a fake trend', () => {
  assert.equal(summarizeTrend([], 'X').direction, 'insufficient-data');
  assert.equal(summarizeTrend([0.4], 'X').direction, 'insufficient-data');
  assert.equal(summarizeTrend([null, 0.4, null], 'X').direction, 'insufficient-data');
});

test('a falling series reads as improving with the percent drop in the headline', () => {
  const trend = summarizeTrend([0.5, 0.4, 0.2, 0.1], 'Reviewer rewriting');
  assert.equal(trend.direction, 'improving');
  assert.ok(trend.headline.includes('fell'));
  assert.ok(trend.headline.includes('4 measured runs'));
  assert.ok(trend.headline.includes('compounding'));
});

test('a rising series reads as worsening — the view never spins bad news', () => {
  const trend = summarizeTrend([0.1, 0.2, 0.4, 0.5], 'Feature rejection rate');
  assert.equal(trend.direction, 'worsening');
  assert.ok(trend.headline.includes('rose'));
});

test('a <5% relative move reads as flat; unmeasured runs are skipped', () => {
  assert.equal(summarizeTrend([0.4, 0.41, null, 0.4], 'X').direction, 'flat');
  assert.equal(summarizeTrend([0, null, 0], 'X').direction, 'flat');
});

test('sparkline points scale into the 200x40 viewBox and skip null runs', () => {
  const pts = sparklinePoints([0.5, null, 0.25, 0.1]);
  const pairs = pts.split(' ').map((p) => p.split(',').map(Number));
  assert.equal(pairs.length, 3, 'null run skipped');
  for (const [x, y] of pairs) {
    assert.ok((x as number) >= 0 && (x as number) <= 200);
    assert.ok((y as number) >= 0 && (y as number) <= 40);
  }
  assert.equal(sparklinePoints([0.4]), '', 'a single point draws nothing');
});

test('percent cells render ratios and an em dash for unmeasured', () => {
  assert.equal(percentCell(0.42), '42%');
  assert.equal(percentCell(null), '—');
});
