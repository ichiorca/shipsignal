// Frontend audit — unit tests for aggregateCostByNode, the per-node spend rollup behind the
// "Where the spend goes" chart. The DB groups telemetry by (node, model), so one node can appear
// multiple times; the chart needs a unique entry per node, summed across models, most-expensive
// first.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateCostByNode } from '../app/lib/cost.ts';
import type { CostByNode } from '../app/lib/cost.ts';

function node(overrides: Partial<CostByNode>): CostByNode {
  return {
    node_name: 'generate_artifact',
    model_id: 'anthropic.claude',
    model_tier: 'STANDARD',
    calls: 1,
    input_tokens: 0,
    output_tokens: 0,
    latency_ms_total: 0,
    cost_usd: 0,
    ...overrides,
  };
}

test('sums cost across models for the same node into one entry', () => {
  const rows = [
    node({ node_name: 'generate_artifact', model_id: 'm1', cost_usd: 0.02 }),
    node({ node_name: 'generate_artifact', model_id: 'm2', cost_usd: 0.03 }),
    node({ node_name: 'extract_claims', model_id: 'm1', cost_usd: 0.01 }),
  ];
  const result = aggregateCostByNode(rows);
  assert.equal(result.length, 2, 'two distinct nodes');
  const generate = result.find((r) => r.node_name === 'generate_artifact');
  assert.ok(generate);
  assert.ok(Math.abs(generate.cost_usd - 0.05) < 1e-9, 'summed across both models');
});

test('orders nodes most-expensive first', () => {
  const rows = [
    node({ node_name: 'cheap', cost_usd: 0.001 }),
    node({ node_name: 'pricey', cost_usd: 0.5 }),
    node({ node_name: 'mid', cost_usd: 0.1 }),
  ];
  assert.deepEqual(
    aggregateCostByNode(rows).map((r) => r.node_name),
    ['pricey', 'mid', 'cheap'],
  );
});

test('empty input yields an empty rollup', () => {
  assert.deepEqual(aggregateCostByNode([]), []);
});
