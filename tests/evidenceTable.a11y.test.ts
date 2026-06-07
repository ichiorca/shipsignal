// T5 (spec 002) — AC: the run-detail evidence view passes axe/keyboard checks (WCAG
// 2.2 AA) AND ships no raw evidence to the client (constitution §4/§5, AC3). Renders
// the real EvidenceTable (the same component the page composes) to static markup, runs
// axe over it in jsdom, and asserts: semantic structure, text-not-colour risk flags,
// the full-excerpt link targets the presigned route (never an s3:// URI).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import axe from 'axe-core';
import { EvidenceTable } from '../app/components/EvidenceTable.ts';
import type { EvidenceItem } from '../app/lib/db/evidenceItems.ts';

const SAMPLE_ITEMS: readonly EvidenceItem[] = [
  {
    id: 'aaaaaaaa-1111-2222-3333-444444444444',
    release_run_id: 'rrrrrrrr-1111-2222-3333-444444444444',
    evidence_type: 'code_diff',
    source: 'git_diff',
    source_url: 'https://github.com/org/product/compare/v1.0.0...v1.1.0',
    repo: 'org/product',
    file_path: 'src/onboarding/Checklist.tsx',
    symbol_name: null,
    redacted_excerpt: 'Add button: Create onboarding checklist for [redacted-email]',
    risk_flags: ['email'],
    confidence: null,
    metadata: { line_range: '42-58' },
    has_raw_blob: true,
  },
  {
    id: 'bbbbbbbb-1111-2222-3333-444444444444',
    release_run_id: 'rrrrrrrr-1111-2222-3333-444444444444',
    evidence_type: 'code_diff',
    source: 'git_diff',
    source_url: null,
    repo: 'org/product',
    file_path: 'README.md',
    symbol_name: null,
    redacted_excerpt: 'Update install steps',
    risk_flags: [],
    confidence: null,
    metadata: {},
    has_raw_blob: false,
  },
];

function render(items: readonly EvidenceItem[]): { doc: Document; html: string } {
  const html = renderToStaticMarkup(
    createElement('main', { id: 'main' }, createElement(EvidenceTable, { items })),
  );
  const doc = new JSDOM(
    `<!doctype html><html lang="en"><body>${html}</body></html>`,
  ).window.document;
  return { doc, html };
}

async function runAxe(doc: Document) {
  return axe.run(doc.body, { rules: { 'color-contrast': { enabled: false } } });
}

test('populated evidence table has zero axe violations', async () => {
  const results = await runAxe(render(SAMPLE_ITEMS).doc);
  assert.deepEqual(
    results.violations.map((v) => v.id),
    [],
    `axe violations: ${JSON.stringify(results.violations.map((v) => v.id))}`,
  );
});

test('empty evidence table has zero axe violations', async () => {
  const results = await runAxe(render([]).doc);
  assert.deepEqual(results.violations.map((v) => v.id), []);
});

test('table is semantically structured: caption + column headers', () => {
  const { doc } = render(SAMPLE_ITEMS);
  assert.equal(
    doc.querySelector('table > caption')?.textContent,
    'Collected evidence (redacted)',
  );
  const headers = [...doc.querySelectorAll('thead th[scope="col"]')].map((h) => h.textContent);
  assert.deepEqual(headers, [
    'File',
    'Type',
    'Source',
    'Redacted excerpt',
    'Risk flags',
    'Full excerpt',
  ]);
});

test('risk flags are conveyed as text, not colour alone', () => {
  const { doc } = render(SAMPLE_ITEMS);
  const risks = [...doc.querySelectorAll('td[data-risk] span')].map((s) => s.textContent);
  assert.deepEqual(risks, ['email', 'none']);
});

test('full-excerpt link targets the presigned route, never an s3:// URI', () => {
  const { doc, html } = render(SAMPLE_ITEMS);
  const links = [...doc.querySelectorAll('tbody a[href]')].map((a) => a.getAttribute('href'));
  assert.ok(links.includes('/api/evidence/aaaaaaaa-1111-2222-3333-444444444444/raw'));
  // AC3: no raw S3 URI is ever placed in the client markup.
  assert.ok(!html.includes('s3://'), 'markup must not contain an s3:// URI');
});

test('items without a raw blob render no full-excerpt link', () => {
  const { doc } = render(SAMPLE_ITEMS);
  // The second row (README.md, has_raw_blob=false) shows an em dash, not a link.
  const rows = [...doc.querySelectorAll('tbody tr')];
  const secondRowLinks = rows[1]?.querySelectorAll('a[href^="/api/evidence"]') ?? [];
  assert.equal(secondRowLinks.length, 0);
});
