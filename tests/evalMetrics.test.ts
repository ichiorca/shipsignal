// T5/T6 (spec 013) / T5 (spec 020) — pure eval-shaping logic (PRD §17.1). Covers summarizeEvals
// (latest row per metric, rubric averaging, every metric always present — the seven §17.1 ones
// plus the spec-020 notify→decision latency split) and the formatters (rate %, latency
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

test('summarizeEvals always returns every metric in PRD order', () => {
  const summary = summarizeEvals([]);
  assert.deepEqual(
    summary.metrics.map((m) => m.name),
    [...METRIC_ORDER],
  );
  // With no rows every metric is unscored and there is no rubric. T1 (spec 021): the
  // engagement count metrics announce "not yet reported" (never 0); rates/durations
  // stay "n/a".
  assert.ok(summary.metrics.every((m) => m.score === null));
  assert.ok(
    summary.metrics.every((m) =>
      m.name.startsWith('engagement_')
        ? m.display === 'not yet reported'
        : m.display === 'n/a',
    ),
  );
  assert.equal(summary.rubricAverage, null);
  assert.equal(summary.rubricCount, 0);
});

test('engagement totals render as grouped counts; missing as "not yet reported"', () => {
  // T1 (spec 021): the §17.1 outcome extension — counts, never rates/percentages.
  assert.equal(formatScore('engagement_views_total', 1200), '1,200');
  assert.equal(formatScore('engagement_clicks_total', 0), '0'); // a reported zero IS zero
  assert.equal(formatScore('engagement_conversions_total', null), 'not yet reported');
});

test('the notify→decision latency split renders next to approval latency', () => {
  // T5 (spec 020) AC: the split is surfaced ALONGSIDE approval latency on the evals page.
  const approvalIndex = METRIC_ORDER.indexOf('approval_latency_seconds');
  assert.equal(METRIC_ORDER[approvalIndex + 1], 'notify_to_decision_latency_seconds');
  // Duration formatting matches approval latency (a time span, not a rate).
  assert.equal(formatScore('notify_to_decision_latency_seconds', 200), '3m 20s');
  assert.equal(formatScore('notify_to_decision_latency_seconds', null), 'n/a');
  assert.equal(
    formatDetail('notify_to_decision_latency_seconds', { sample_count: 2 }),
    '2 samples',
  );
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
