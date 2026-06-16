// Frontend audit (gap #2) — unit tests for filterEvidence plus an axe/a11y pass over the
// interactive EvidenceFeed wrapper (labelled search, live count, paginator).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import axe from 'axe-core';
import { filterEvidence } from '../app/lib/evidenceFilter.ts';
import { EvidenceFeed } from '../app/components/EvidenceFeed.ts';
import type { EvidenceItem } from '../app/lib/db/evidenceItems.ts';

function makeItem(overrides: Partial<EvidenceItem>): EvidenceItem {
  return {
    id: 'ev-1',
    release_run_id: 'run-1',
    evidence_type: 'pull_request',
    source: 'github',
    source_url: null,
    repo: 'org/product',
    file_path: 'src/app.ts',
    symbol_name: null,
    redacted_excerpt: 'added a cache layer',
    risk_flags: [],
    confidence: 0.9,
    metadata: {},
    has_raw_blob: false,
    ...overrides,
  };
}

const ITEMS: readonly EvidenceItem[] = [
  makeItem({ id: 'ev-1', file_path: 'src/cache.ts', redacted_excerpt: 'cache layer', evidence_type: 'pull_request' }),
  makeItem({ id: 'ev-2', file_path: 'src/auth.ts', symbol_name: 'loginUser', redacted_excerpt: 'auth flow', evidence_type: 'code_signal' }),
  makeItem({ id: 'ev-3', file_path: 'README.md', redacted_excerpt: 'docs update', evidence_type: 'docs' }),
];

test('filterEvidence matches across file path, type, symbol, and excerpt', () => {
  assert.deepEqual(filterEvidence(ITEMS, 'cache').map((i) => i.id), ['ev-1']);
  assert.deepEqual(filterEvidence(ITEMS, 'loginuser').map((i) => i.id), ['ev-2']);
  assert.deepEqual(filterEvidence(ITEMS, 'docs').map((i) => i.id), ['ev-3']);
  assert.deepEqual(filterEvidence(ITEMS, 'src/').map((i) => i.id), ['ev-1', 'ev-2']);
});

test('filterEvidence with empty query returns everything', () => {
  assert.equal(filterEvidence(ITEMS, '').length, 3);
  assert.equal(filterEvidence(ITEMS, '   ').length, 3);
});

function render(items: readonly EvidenceItem[], pageSize?: number): Document {
  const props = pageSize === undefined ? { items } : { items, pageSize };
  const html = renderToStaticMarkup(
    createElement('main', { id: 'main' }, createElement(EvidenceFeed, props)),
  );
  return new JSDOM(`<!doctype html><html lang="en"><body>${html}</body></html>`).window.document;
}

test('EvidenceFeed has zero axe violations and a labelled search', async () => {
  const doc = render(ITEMS);
  const results = await axe.run(doc.body, { rules: { 'color-contrast': { enabled: false } } });
  assert.deepEqual(
    results.violations.map((v) => v.id),
    [],
    `axe violations: ${JSON.stringify(results.violations.map((v) => v.id))}`,
  );
  assert.ok(doc.querySelector('label[for="evidence-search"]'));
  assert.ok(doc.querySelector('form[role="search"]'));
});

test('EvidenceFeed renders a live result count', () => {
  const count = render(ITEMS).querySelector('[data-evidence-count][role="status"]')?.textContent ?? '';
  assert.match(count, /Showing 3 of 3 items/);
});

test('EvidenceFeed paginates only when more than one page', () => {
  assert.ok(render(ITEMS, 2).querySelector('[data-evidence-paginator]'));
  assert.equal(render(ITEMS, 25).querySelector('[data-evidence-paginator]'), null);
});

test('empty evidence renders the table empty state, no search chrome', () => {
  const doc = render([]);
  assert.equal(doc.querySelector('form[role="search"]'), null);
  assert.ok(doc.querySelector('table'));
});
