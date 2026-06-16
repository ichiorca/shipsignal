// Frontend audit — AC: the reusable BarChart passes axe/keyboard checks (WCAG 2.2 AA) and keeps
// every value available as real text (the bar is decoration, not the sole carrier). Renders the
// component to static markup, runs axe-core in jsdom, and asserts the semantic table structure
// plus that drill-down rows expose keyboard-focusable links.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import axe from 'axe-core';
import { BarChart, type BarDatum } from '../app/components/BarChart.ts';

const DATA: readonly BarDatum[] = [
  { label: 'generate_artifact', value: 0.0123, href: '/releases/run-1', title: 'run-1' },
  { label: 'extract_claims', value: 0.004 },
  { label: 'cluster_features', value: 0.0 },
];

function render(data: readonly BarDatum[]): Document {
  const html = renderToStaticMarkup(
    createElement(
      'main',
      { id: 'main' },
      createElement(BarChart, {
        caption: 'Estimated cost by node',
        labelHeader: 'Node',
        valueHeader: 'Est. cost',
        data,
        formatValue: (usd: number) => `$${usd.toFixed(4)}`,
      }),
    ),
  );
  return new JSDOM(`<!doctype html><html lang="en"><body>${html}</body></html>`).window.document;
}

async function runAxe(doc: Document) {
  return axe.run(doc.body, { rules: { 'color-contrast': { enabled: false } } });
}

test('populated bar chart has zero axe violations', async () => {
  const results = await runAxe(render(DATA));
  assert.deepEqual(
    results.violations.map((v) => v.id),
    [],
    `axe violations: ${JSON.stringify(results.violations.map((v) => v.id))}`,
  );
});

test('empty bar chart renders an empty-state message, no violations', async () => {
  const doc = render([]);
  assert.match(doc.body.textContent ?? '', /No data to chart yet\./);
  const results = await runAxe(doc);
  assert.deepEqual(results.violations.map((v) => v.id), []);
});

test('chart is a captioned table with column headers', () => {
  const doc = render(DATA);
  assert.equal(doc.querySelector('table[data-bar-chart] > caption')?.textContent, 'Estimated cost by node');
  const headers = [...doc.querySelectorAll('thead th[scope="col"]')].map((h) => h.textContent);
  assert.deepEqual(headers, ['Node', 'Est. cost']);
});

test('every value is present as formatted text, not bar length alone', () => {
  const doc = render(DATA);
  const values = [...doc.querySelectorAll('[data-bar-value]')].map((v) => v.textContent);
  assert.deepEqual(values, ['$0.0123', '$0.0040', '$0.0000']);
});

test('rows with an href expose a keyboard-focusable drill-down link', () => {
  const doc = render(DATA);
  const link = doc.querySelector('tbody th[scope="row"] a[href]');
  assert.equal(link?.getAttribute('href'), '/releases/run-1');
});

test('the proportional fill is aria-hidden (decorative)', () => {
  const doc = render(DATA);
  const fills = [...doc.querySelectorAll('[data-bar-fill]')];
  assert.ok(fills.length > 0);
  assert.ok(fills.every((f) => f.getAttribute('aria-hidden') === 'true'));
});
