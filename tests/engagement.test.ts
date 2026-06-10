// T1/T5 (spec 021) — unit coverage for the pure engagement/ROI math. The load-bearing
// assertions: "not yet reported" (null) survives every aggregation step and is never
// coerced to 0 (spec AC), cost-per-click exists only when BOTH sides exist, and the
// per-type cost is an even apportionment of only the artifact-generation node families.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  artifactGenerationCostUsd,
  buildRoiSummary,
  costPerClickUsd,
  isEngagementMetricKind,
  type EngagementByType,
} from '../app/lib/engagement.ts';
import type { CostByNode, RunCostBreakdown } from '../app/lib/cost.ts';
import { summarizeCost } from '../app/lib/cost.ts';

function node(node_name: string, cost_usd: number): CostByNode {
  return {
    node_name,
    model_id: 'model-x',
    model_tier: 'standard',
    calls: 1,
    input_tokens: 100,
    output_tokens: 100,
    latency_ms_total: 50,
    cost_usd,
  };
}

function breakdown(byNode: readonly CostByNode[]): RunCostBreakdown {
  return { byNode, totals: summarizeCost(byNode) };
}

const COSTS = breakdown([
  node('generate_', 0.6),
  node('extract_claims_', 0.2),
  node('cluster_features', 0.4), // not artifact generation — excluded from apportionment
]);

const ENGAGEMENT: readonly EngagementByType[] = [
  {
    artifact_type: 'release_blog',
    views: 1200,
    clicks: 40,
    conversions: null,
    latest_as_of: '2026-06-08',
  },
];

test('metric kind guard accepts exactly the closed vocabulary', () => {
  assert.ok(isEngagementMetricKind('views'));
  assert.ok(isEngagementMetricKind('clicks'));
  assert.ok(isEngagementMetricKind('conversions'));
  assert.ok(!isEngagementMetricKind('user_id'));
  assert.ok(!isEngagementMetricKind(''));
});

test('generation cost sums only the artifact-generation node families', () => {
  assert.ok(Math.abs(artifactGenerationCostUsd(COSTS.byNode) - 0.8) < 1e-9);
});

test('cost-per-click exists only when both sides exist', () => {
  assert.equal(costPerClickUsd(1.2, null), null); // clicks never reported
  assert.equal(costPerClickUsd(1.2, 0), null); // reported zero clicks: no division
  assert.equal(costPerClickUsd(0, 40), null); // no recorded cost
  assert.equal(costPerClickUsd(1.2, 40), 0.03);
});

test('ROI rows cover every artifact type; missing engagement stays null, never 0', () => {
  const summary = buildRoiSummary(['release_blog', 'changelog'], ENGAGEMENT, COSTS);
  assert.deepEqual(
    summary.rows.map((r) => r.artifact_type),
    ['changelog', 'release_blog'],
  );
  const changelog = summary.rows.find((r) => r.artifact_type === 'changelog');
  assert.equal(changelog?.views, null);
  assert.equal(changelog?.clicks, null);
  assert.equal(changelog?.conversions, null);
  const blog = summary.rows.find((r) => r.artifact_type === 'release_blog');
  assert.equal(blog?.views, 1200);
  assert.equal(blog?.conversions, null); // reported type, unreported metric
});

test('per-type cost is an even apportionment of the generation spend', () => {
  const summary = buildRoiSummary(['release_blog', 'changelog'], ENGAGEMENT, COSTS);
  for (const row of summary.rows) {
    assert.ok(row.apportioned_cost_usd !== null);
    assert.ok(Math.abs(row.apportioned_cost_usd - 0.4) < 1e-9);
  }
});

test('run totals: cost-per-click from the FULL run cost and reported clicks', () => {
  const summary = buildRoiSummary(['release_blog'], ENGAGEMENT, COSTS);
  assert.equal(summary.run_cost_usd, COSTS.totals.cost_usd);
  assert.equal(summary.total_views, 1200);
  assert.equal(summary.total_clicks, 40);
  assert.equal(summary.total_conversions, null); // nothing reported anywhere
  assert.ok(Math.abs((summary.cost_per_click_usd ?? 0) - 1.2 / 40) < 1e-9);
});

test('a run with no engagement at all has null totals and no cost-per-click', () => {
  const summary = buildRoiSummary(['release_blog'], [], COSTS);
  assert.equal(summary.total_views, null);
  assert.equal(summary.total_clicks, null);
  assert.equal(summary.total_conversions, null);
  assert.equal(summary.cost_per_click_usd, null);
});

test('a run with no telemetry has null per-type cost (not a fabricated 0)', () => {
  const summary = buildRoiSummary(['release_blog'], ENGAGEMENT, breakdown([]));
  assert.equal(summary.rows[0]?.apportioned_cost_usd, null);
  assert.equal(summary.cost_per_click_usd, null);
});

test('engagement for a type absent from the draft list still gets a row', () => {
  const summary = buildRoiSummary([], ENGAGEMENT, COSTS);
  assert.deepEqual(
    summary.rows.map((r) => r.artifact_type),
    ['release_blog'],
  );
});
