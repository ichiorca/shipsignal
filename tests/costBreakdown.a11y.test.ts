// T5 (spec 011) — AC: the per-run cost view is WCAG 2.2 AA with a keyboard-operable, semantic
// breakdown. Renders the real CostBreakdown (the same component the cost page composes) to static
// markup, runs axe over it in jsdom, and asserts: zero axe violations, the breakdown is a
// semantic <table> with a <caption> and column <th scope="col">, each node row is a <th scope="row">
// with its tier + model shown as TEXT (not colour alone), a <tfoot> run-totals row sums the nodes,
// and the empty state degrades gracefully. constitution §5: only metrics + provenance render — no
// prompt/evidence/output — so the props type (CostByNode) carries nothing sensitive.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import axe from 'axe-core';
import { CostBreakdown } from '../app/components/CostBreakdown.ts';
import { summarizeCost } from '../app/lib/cost.ts';
import type { CostByNode, RunCostBreakdown } from '../app/lib/cost.ts';

const BY_NODE: readonly CostByNode[] = [
  {
    node_name: 'cluster_features',
    model_id: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
    model_tier: 'standard',
    calls: 1,
    input_tokens: 18000,
    output_tokens: 3200,
    latency_ms_total: 4200,
    cost_usd: 0.102,
  },
  {
    node_name: 'extract_claims_',
    model_id: 'anthropic.claude-3-haiku-20240307-v1:0',
    model_tier: 'cheap',
    calls: 2,
    input_tokens: 10000,
    output_tokens: 2500,
    latency_ms_total: 2300,
    cost_usd: 0.00563,
  },
];

const BREAKDOWN: RunCostBreakdown = { byNode: BY_NODE, totals: summarizeCost(BY_NODE) };

function render(breakdown: RunCostBreakdown): { doc: Document } {
  const html = renderToStaticMarkup(
    createElement(
      'main',
      { id: 'main' },
      createElement('h1', null, 'Model cost & latency'),
      createElement(CostBreakdown, { breakdown }),
    ),
  );
  const doc = new JSDOM(`<!doctype html><html lang="en"><body>${html}</body></html>`)
    .window.document;
  return { doc };
}

async function runAxe(doc: Document) {
  return axe.run(doc.body, { rules: { 'color-contrast': { enabled: false } } });
}

test('populated cost breakdown has zero axe violations', async () => {
  const results = await runAxe(render(BREAKDOWN).doc);
  assert.deepEqual(
    results.violations.map((v) => v.id),
    [],
    `axe violations: ${JSON.stringify(results.violations.map((v) => v.id))}`,
  );
});

test('empty cost breakdown has zero axe violations and an empty state', async () => {
  const empty: RunCostBreakdown = { byNode: [], totals: summarizeCost([]) };
  const { doc } = render(empty);
  const results = await runAxe(doc);
  assert.deepEqual(results.violations.map((v) => v.id), []);
  assert.match(doc.body.textContent ?? '', /No model-call telemetry/);
});

test('the breakdown is a semantic table with a caption and column headers', () => {
  const { doc } = render(BREAKDOWN);
  const table = doc.querySelector('table');
  assert.ok(table, 'a <table> renders');
  assert.ok(table?.querySelector('caption'), 'the table has a <caption>');
  const colHeaders = [...doc.querySelectorAll('thead th[scope="col"]')];
  assert.equal(colHeaders.length, 8, 'eight column headers (node…cost)');
});

test('each node row is a row-header with its tier shown as text (not colour alone)', () => {
  const { doc } = render(BREAKDOWN);
  const rowHeaders = [...doc.querySelectorAll('tbody th[scope="row"]')];
  assert.equal(rowHeaders.length, 2, 'one row-header per node');
  assert.equal(rowHeaders[0]?.textContent, 'cluster_features');
  const tierCell = doc.querySelector('tbody tr[data-node="cluster_features"] td[data-tier]');
  assert.equal(tierCell?.getAttribute('data-tier'), 'standard');
  assert.equal(tierCell?.textContent, 'standard', 'tier is conveyed as text, not only data-attr');
});

test('a tfoot run-totals row sums the node costs', () => {
  const { doc } = render(BREAKDOWN);
  const totalsRow = doc.querySelector('tfoot tr[data-totals="run"]');
  assert.ok(totalsRow, 'a totals row renders in the tfoot');
  assert.equal(totalsRow?.querySelector('th[scope="row"]')?.textContent, 'Run total');
  // 0.102 + 0.00563 = 0.10763 → formatted to 4dp.
  assert.match(totalsRow?.textContent ?? '', /\$0\.1076/);
});
