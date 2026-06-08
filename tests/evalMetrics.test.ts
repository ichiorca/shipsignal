// T5/T6 (spec 013) — pure eval-shaping logic (PRD §17.1). Covers summarizeEvals (latest row per
// metric, rubric averaging, all seven metrics always present) and the formatters (rate %, latency
// humanization, n/a for null, PII-free detail). No DB/React — the dashboard, page, read API, and
// a11y test all rely on this one implementation.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  METRIC_ORDER,
  formatDetail,
  formatScore,
  humanizeSeconds,
  summarizeEvals,
} from '../app/lib/evalMetrics.ts';
import type { EvalRunRow } from '../app/lib/evalMetrics.ts';

test('summarizeEvals always returns the seven metrics in PRD order', () => {
  const summary = summarizeEvals([]);
  assert.deepEqual(
    summary.metrics.map((m) => m.name),
    [...METRIC_ORDER],
  );
  // With no rows every metric is n/a and there is no rubric.
  assert.ok(summary.metrics.every((m) => m.score === null && m.display === 'n/a'));
  assert.equal(summary.rubricAverage, null);
  assert.equal(summary.rubricCount, 0);
});

test('summarizeEvals keeps the latest row per metric (rows are newest-first)', () => {
  const rows: EvalRunRow[] = [
    {
      eval_type: 'evidence_coverage',
      score: 0.9,
      findings: { numerator: 9, denominator: 10 },
      created_at: '2026-06-08T02:00:00Z',
    },
    {
      eval_type: 'evidence_coverage',
      score: 0.5,
      findings: { numerator: 5, denominator: 10 },
      created_at: '2026-06-08T01:00:00Z',
    },
  ];
  const coverage = summarizeEvals(rows).metrics.find((m) => m.name === 'evidence_coverage');
  assert.equal(coverage?.score, 0.9);
  assert.equal(coverage?.display, '90.0%');
  assert.equal(coverage?.detail, '9 / 10');
});

test('summarizeEvals averages rubric rows into one headline', () => {
  const rows: EvalRunRow[] = [
    { eval_type: 'rubric', score: 4, findings: {}, created_at: 'x' },
    { eval_type: 'rubric', score: 3, findings: {}, created_at: 'x' },
    { eval_type: 'rubric', score: null, findings: {}, created_at: 'x' },
  ];
  const summary = summarizeEvals(rows);
  assert.equal(summary.rubricCount, 2); // null-scored rubric ignored
  assert.equal(summary.rubricAverage, 3.5);
});

test('formatScore renders rates as % and null as n/a', () => {
  assert.equal(formatScore('unsupported_claim_rate', 0.1), '10.0%');
  assert.equal(formatScore('edit_distance', 0.25), '25.0%');
  assert.equal(formatScore('approval_latency_seconds', null), 'n/a');
});

test('humanizeSeconds renders compact durations', () => {
  assert.equal(humanizeSeconds(45), '45s');
  assert.equal(humanizeSeconds(200), '3m 20s');
  assert.equal(humanizeSeconds(3725), '1h 2m');
});

test('formatDetail surfaces counts only, flagging repo-global scope', () => {
  assert.equal(formatDetail('evidence_coverage', { numerator: 8, denominator: 10 }), '8 / 10');
  assert.equal(
    formatDetail('skill_candidate_acceptance_rate', {
      numerator: 2,
      denominator: 5,
      scope: 'repo_global',
    }),
    '2 / 5 (repo-wide)',
  );
  assert.equal(formatDetail('edit_distance', { sample_count: 1 }), '1 sample');
  assert.equal(formatDetail('approval_latency_seconds', { sample_count: 3 }), '3 samples');
});
