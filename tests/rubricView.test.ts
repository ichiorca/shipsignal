// Frontend audit (gap #1) — unit tests for averageRubricDimensions, the per-dimension rollup
// behind the eval page's rubric chart. Verifies cross-artifact averaging, partial/garbage maps
// (the data crosses the DB boundary, so non-numeric / out-of-range values must be ignored), and
// canonical dimension ordering.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  averageRubricDimensions,
  rubricOverall,
  RUBRIC_DIMENSIONS,
  type RubricMap,
} from '../app/lib/rubricView.ts';

test('averages each dimension across all artifact rubric maps', () => {
  const maps: readonly RubricMap[] = [
    { claim_support: 4, claim_risk: 5, brand_voice: 3, audience_relevance: 4, originality: 3, conversion_intent: 4, clarity: 5, demoability: 2 },
    { claim_support: 2, claim_risk: 3, brand_voice: 5, audience_relevance: 2, originality: 5, conversion_intent: 2, clarity: 3, demoability: 4 },
  ];
  const result = averageRubricDimensions(maps);
  const support = result.find((d) => d.key === 'claim_support');
  assert.ok(support);
  assert.equal(support.average, 3); // (4 + 2) / 2
  assert.equal(support.count, 2);
});

test('returns all eight dimensions in canonical order', () => {
  const result = averageRubricDimensions([]);
  assert.deepEqual(
    result.map((d) => d.key),
    RUBRIC_DIMENSIONS.map((d) => d.key),
  );
  // No artifacts → every dimension null with count 0.
  assert.ok(result.every((d) => d.average === null && d.count === 0));
});

test('ignores missing, non-numeric, and out-of-range values', () => {
  const maps: readonly RubricMap[] = [
    { claim_support: 4 },
    { claim_support: 'oops' }, // non-numeric → ignored
    { claim_support: 9 }, // out of 1..5 range → ignored
    {}, // missing → ignored
  ];
  const support = averageRubricDimensions(maps).find((d) => d.key === 'claim_support');
  assert.ok(support);
  assert.equal(support.average, 4); // only the single valid value
  assert.equal(support.count, 1);
});

test('rubricOverall is the mean of scored dimensions (nulls ignored), null when none', () => {
  // Two dimensions scored 4 and 2 → overall 3; unscored dimensions don't drag it down.
  const dims = averageRubricDimensions([{ claim_support: 4, clarity: 2 }]);
  assert.equal(rubricOverall(dims), 3);
  // Nothing scored → null (not 0).
  assert.equal(rubricOverall(averageRubricDimensions([])), null);
});

test('a dimension scored by only some artifacts averages over just those', () => {
  const maps: readonly RubricMap[] = [
    { clarity: 5 },
    { brand_voice: 3 }, // no clarity here
  ];
  const result = averageRubricDimensions(maps);
  assert.equal(result.find((d) => d.key === 'clarity')?.average, 5);
  assert.equal(result.find((d) => d.key === 'clarity')?.count, 1);
  assert.equal(result.find((d) => d.key === 'brand_voice')?.average, 3);
});
