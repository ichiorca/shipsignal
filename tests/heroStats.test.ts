// Operator feedback 2026-06-09 (priority 2) — the hero stat shaping: honest placeholders
// before data exists (never a fabricated number), and the speed/cost/trust/output framing
// computed from aggregates the pipeline already records.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildHeroStats,
  formatDuration,
  formatUsd,
  PMM_BASELINE_HOURS_PER_RELEASE,
  type HeroStatsData,
} from '../app/lib/heroStats.ts';

const EMPTY: HeroStatsData = {
  artifactsShipped: 0,
  claimsEvidenceBackedRate: null,
  medianSecondsToApprovedContent: null,
  avgModelCostPerRunUsd: null,
  releasesWithApprovedContent: 0,
};

test('an empty deployment renders placeholders, never fabricated numbers', () => {
  const stats = buildHeroStats(EMPTY);
  const byKey = new Map(stats.map((s) => [s.key, s]));
  assert.equal(byKey.get('speed')?.value, '—');
  assert.equal(byKey.get('cost')?.value, '—');
  assert.equal(byKey.get('trust')?.value, '—');
  assert.equal(byKey.get('output')?.value, '0');
});

test('a populated deployment tells the speed/cost/trust/output story', () => {
  const stats = buildHeroStats({
    artifactsShipped: 14,
    claimsEvidenceBackedRate: 0.964,
    medianSecondsToApprovedContent: 42 * 60,
    avgModelCostPerRunUsd: 0.84,
    releasesWithApprovedContent: 3,
  });
  const byKey = new Map(stats.map((s) => [s.key, s]));
  assert.equal(byKey.get('speed')?.value, '42m');
  assert.equal(byKey.get('speed')?.detail, 'median across 3 releases');
  // R6 — the cost tile now leads with dollars SAVED: 4h @ $75/h ($300) minus $0.84 model spend.
  assert.equal(byKey.get('cost')?.value, '$299');
  assert.equal(byKey.get('cost')?.label, 'saved per release');
  assert.ok(byKey.get('cost')?.detail.includes(`~${PMM_BASELINE_HOURS_PER_RELEASE}h of PMM`));
  assert.ok(byKey.get('cost')?.detail.includes('$0.84'), 'detail shows the model spend it replaced');
  assert.equal(byKey.get('trust')?.value, '96%');
  assert.equal(byKey.get('output')?.value, '14');
});

test('savings still shows once a release completes, even before cost telemetry exists', () => {
  // releases exist but no model-cost telemetry yet → savings ≈ the labor value (4h @ $75/h).
  const stats = buildHeroStats({
    artifactsShipped: 2,
    claimsEvidenceBackedRate: 1,
    medianSecondsToApprovedContent: 600,
    avgModelCostPerRunUsd: null,
    releasesWithApprovedContent: 1,
  });
  const cost = new Map(stats.map((s) => [s.key, s])).get('cost');
  assert.equal(cost?.value, '$300');
  assert.equal(cost?.detail.includes('model spend'), false, 'no spend clause when cost is unknown');
});

test('durations switch to hours past 90 minutes', () => {
  assert.equal(formatDuration(30 * 60), '30m');
  assert.equal(formatDuration(89 * 60), '89m');
  assert.equal(formatDuration(3 * 3600), '3.0h');
  assert.equal(formatDuration(20), '1m'); // sub-minute rounds up, never "0m"
});

test('tiny but nonzero spend renders as <$0.01, not $0.00', () => {
  assert.equal(formatUsd(0.004), '<$0.01');
  assert.equal(formatUsd(0), '$0.00');
  assert.equal(formatUsd(1.5), '$1.50');
});
