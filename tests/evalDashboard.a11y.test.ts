// T5 (spec 013) — AC: the per-run Eval dashboard is WCAG 2.2 AA and renders unsupported-claim
// rate, edit distance, and approval latency per run. Renders the real EvalDashboard (the same
// component the eval page composes) to static markup, runs axe over it in jsdom, and asserts:
// zero axe violations, a semantic <table> with a <caption> and column <th scope="col">, each
// metric row is a <th scope="row"> with its score as TEXT (not style alone), the three AC
// headline metrics are present, the rubric headline renders, and the empty state degrades
// gracefully. constitution §5: only metric scores + counts render — no prompt/evidence/body.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import axe from 'axe-core';
import { EvalDashboard } from '../app/components/EvalDashboard.ts';
import { summarizeEvals } from '../app/lib/evalMetrics.ts';
import type { EvalRunRow, RunEvalSummary } from '../app/lib/evalMetrics.ts';

const ROWS: readonly EvalRunRow[] = [
  {
    eval_type: 'unsupported_claim_rate',
    score: 0.1,
    findings: { numerator: 1, denominator: 10 },
    created_at: '2026-06-08T00:00:00Z',
  },
  {
    eval_type: 'edit_distance',
    score: 0.25,
    findings: { sample_count: 3 },
    created_at: '2026-06-08T00:00:00Z',
  },
  {
    eval_type: 'approval_latency_seconds',
    score: 3725,
    findings: { sample_count: 2 },
    created_at: '2026-06-08T00:00:00Z',
  },
  {
    eval_type: 'evidence_coverage',
    score: 0.9,
    findings: { numerator: 9, denominator: 10 },
    created_at: '2026-06-08T00:00:00Z',
  },
  {
    eval_type: 'rubric',
    score: 4.0,
    findings: { human_override: 'false' },
    created_at: '2026-06-08T00:00:00Z',
  },
  {
    eval_type: 'rubric',
    score: 3.0,
    findings: { human_override: 'true' },
    created_at: '2026-06-08T00:00:00Z',
  },
];

const SUMMARY: RunEvalSummary = summarizeEvals(ROWS);

function render(summary: RunEvalSummary): { doc: Document } {
  const html = renderToStaticMarkup(
    createElement(
      'main',
      { id: 'main' },
      createElement('h1', null, 'Evaluation'),
      createElement(EvalDashboard, { summary }),
    ),
  );
  const doc = new JSDOM(`<!doctype html><html lang="en"><body>${html}</body></html>`)
    .window.document;
  return { doc };
}

async function runAxe(doc: Document) {
  return axe.run(doc.body, { rules: { 'color-contrast': { enabled: false } } });
}

test('populated eval dashboard has zero axe violations', async () => {
  const results = await runAxe(render(SUMMARY).doc);
  assert.deepEqual(
    results.violations.map((v) => v.id),
    [],
    `axe violations: ${JSON.stringify(results.violations.map((v) => v.id))}`,
  );
});

test('empty eval dashboard has zero axe violations and empty states', async () => {
  const empty = summarizeEvals([]);
  const { doc } = render(empty);
  const results = await runAxe(doc);
  assert.deepEqual(results.violations.map((v) => v.id), []);
  // Every metric still renders (n/a), and the rubric empty state shows.
  assert.match(doc.body.textContent ?? '', /No LLM-as-judge rubric scores/);
  assert.match(doc.body.textContent ?? '', /n\/a/);
});

test('the dashboard is a semantic table with a caption and column headers', () => {
  const { doc } = render(SUMMARY);
  const table = doc.querySelector('table');
  assert.ok(table, 'a <table> renders');
  assert.ok(table?.querySelector('caption'), 'the table has a <caption>');
  const colHeaders = [...doc.querySelectorAll('thead th[scope="col"]')];
  assert.equal(colHeaders.length, 3, 'three column headers (metric/score/detail)');
});

test('the three AC headline metrics render with scores as text', () => {
  const { doc } = render(SUMMARY);
  for (const name of ['unsupported_claim_rate', 'edit_distance', 'approval_latency_seconds']) {
    const row = doc.querySelector(`tbody tr[data-metric="${name}"]`);
    assert.ok(row, `${name} row renders`);
    assert.ok(row?.querySelector('th[scope="row"]'), `${name} has a row header`);
  }
  // Unsupported-claim rate 0.1 → "10.0%"; latency 3725s → "1h 2m"; both conveyed as text.
  const rate = doc.querySelector('tbody tr[data-metric="unsupported_claim_rate"] td[data-score]');
  assert.equal(rate?.textContent, '10.0%');
  const latency = doc.querySelector('tbody tr[data-metric="approval_latency_seconds"] td[data-score]');
  assert.equal(latency?.textContent, '1h 2m');
});

test('the rubric headline averages the rubric rows', () => {
  const { doc } = render(SUMMARY);
  const rubric = doc.querySelector('p[data-rubric="summary"]');
  // (4.0 + 3.0) / 2 = 3.50 across 2 artifacts.
  assert.match(rubric?.textContent ?? '', /average 3\.50 \/ 5 across 2 artifacts/);
});
