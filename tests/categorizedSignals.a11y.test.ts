// T5 (spec 003) — AC: the categorized-signals view groups evidence by evidence_type
// with counts + confidence, is keyboard-operable (in-page anchor links + native
// <details>/<summary> disclosures), and passes axe (WCAG 2.2 AA). Renders the real
// CategorizedSignals component (the same one the page composes) to static markup, runs
// axe in jsdom, and asserts the semantic structure + that confidence is shown as text.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import axe from 'axe-core';
import { CategorizedSignals } from '../app/components/CategorizedSignals.ts';
import type { EvidenceItem } from '../app/lib/db/evidenceItems.ts';

function item(overrides: Partial<EvidenceItem>): EvidenceItem {
  return {
    id: 'aaaaaaaa-1111-2222-3333-444444444444',
    release_run_id: 'rrrrrrrr-1111-2222-3333-444444444444',
    evidence_type: 'ui_string_change',
    source: 'git_diff',
    source_url: null,
    repo: 'org/product',
    file_path: 'src/Checklist.tsx',
    symbol_name: null,
    redacted_excerpt: 'Create onboarding checklist',
    risk_flags: [],
    confidence: 0.8,
    metadata: { line_range: '42' },
    has_raw_blob: false,
    ...overrides,
  };
}

const SAMPLE_ITEMS: readonly EvidenceItem[] = [
  item({ id: 'a1', evidence_type: 'ui_string_change', confidence: 0.8 }),
  item({ id: 'a2', evidence_type: 'ui_string_change', confidence: 0.6 }),
  item({
    id: 'b1',
    evidence_type: 'route',
    file_path: 'app/api/teams/route.ts',
    redacted_excerpt: '/api/teams',
    confidence: 0.9,
    metadata: {},
  }),
  item({
    id: 'c1',
    evidence_type: 'docs_delta',
    file_path: 'README.md',
    redacted_excerpt: 'Admin onboarding',
    confidence: null,
    metadata: { line_range: '3' },
  }),
];

function render(items: readonly EvidenceItem[]): { doc: Document; html: string } {
  const html = renderToStaticMarkup(
    createElement('main', { id: 'main' }, createElement(CategorizedSignals, { items })),
  );
  const doc = new JSDOM(
    `<!doctype html><html lang="en"><body>${html}</body></html>`,
  ).window.document;
  return { doc, html };
}

async function runAxe(doc: Document) {
  return axe.run(doc.body, { rules: { 'color-contrast': { enabled: false } } });
}

test('populated categorized view has zero axe violations', async () => {
  const results = await runAxe(render(SAMPLE_ITEMS).doc);
  assert.deepEqual(
    results.violations.map((v) => v.id),
    [],
    `axe violations: ${JSON.stringify(results.violations.map((v) => v.id))}`,
  );
});

test('empty categorized view has zero axe violations', async () => {
  const results = await runAxe(render([]).doc);
  assert.deepEqual(results.violations.map((v) => v.id), []);
});

test('summary table has a caption and the type/count/confidence columns', () => {
  const { doc } = render(SAMPLE_ITEMS);
  assert.equal(doc.querySelector('table > caption')?.textContent, 'Signals by type');
  const headers = [...doc.querySelectorAll('table thead th[scope="col"]')]
    .slice(0, 3)
    .map((h) => h.textContent);
  assert.deepEqual(headers, ['Type', 'Count', 'Avg confidence']);
});

test('groups are ordered by descending count and counted correctly', () => {
  const { doc } = render(SAMPLE_ITEMS);
  const rows = [...doc.querySelectorAll('table tbody tr')];
  // First summary row is the largest group (ui_string_change, 2 items).
  const firstCells = [...(rows[0]?.querySelectorAll('td') ?? [])].map((c) => c.textContent);
  assert.deepEqual(firstCells, ['ui_string_change', '2', '70%']);
});

test('each type is a keyboard-operable disclosure linked from the summary', () => {
  const { doc } = render(SAMPLE_ITEMS);
  // Summary Type cell links to the matching disclosure's id (in-page navigation).
  const links = [...doc.querySelectorAll('table tbody a[href^="#group-"]')].map((a) =>
    a.getAttribute('href'),
  );
  assert.ok(links.includes('#group-ui_string_change'));
  // Native <details>/<summary> disclosures are focusable/operable without JS.
  const summaries = [...doc.querySelectorAll('details > summary')].map((s) => s.id);
  assert.ok(summaries.includes('group-ui_string_change'));
  assert.ok(summaries.includes('group-route'));
});

test('confidence is rendered as text (percent), including an em dash when unscored', () => {
  const { doc } = render(SAMPLE_ITEMS);
  // The docs_delta group has a single unscored item → avg confidence shows "—".
  const docsSummaryRow = [...doc.querySelectorAll('table tbody tr')].find((tr) =>
    tr.querySelector('a')?.textContent === 'docs_delta',
  );
  const cells = [...(docsSummaryRow?.querySelectorAll('td') ?? [])].map((c) => c.textContent);
  assert.deepEqual(cells, ['docs_delta', '1', '—']);
});
