// T6 (spec 001) — AC: the run-list page passes axe/keyboard checks (WCAG 2.2 AA).
// Renders the real RunListTable component (the same one the page composes) to static
// markup, then runs axe-core over it in jsdom and asserts the semantic structure
// keyboard users rely on.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import axe from 'axe-core';
import { RunListTable } from '../app/components/RunListTable.ts';
import type { ReleaseRun } from '../app/lib/db/releaseRuns.ts';

const SAMPLE_RUNS: readonly ReleaseRun[] = [
  {
    id: 'aaaaaaaa-1111-2222-3333-444444444444',
    repo: 'org/product',
    base_ref: 'v1.12.0',
    head_ref: 'v1.13.0',
    trigger_type: 'manual',
    status: 'completed',
    artifact_types: ['release_blog', 'changelog_entry'],
    langgraph_thread_id: 'lg_thread_001',
    started_at: '2026-06-07T10:00:00.000Z',
    completed_at: '2026-06-07T10:05:00.000Z',
  },
  {
    id: 'bbbbbbbb-1111-2222-3333-444444444444',
    repo: 'org/product',
    base_ref: 'v1.13.0^',
    head_ref: 'v1.13.0',
    trigger_type: 'release_tag',
    status: 'collecting_evidence',
    artifact_types: [
      'release_blog',
      'changelog_entry',
      'sales_onepager',
      'linkedin_post',
      'demo_script',
      'release_audio_digest',
    ],
    langgraph_thread_id: null,
    started_at: '2026-06-07T11:00:00.000Z',
    completed_at: null,
  },
];

function render(runs: readonly ReleaseRun[]): Document {
  // Wrap in <main> so axe sees content inside a landmark, mirroring the page.
  const html = renderToStaticMarkup(
    createElement('main', { id: 'main' }, createElement(RunListTable, { runs })),
  );
  return new JSDOM(`<!doctype html><html lang="en"><body>${html}</body></html>`).window.document;
}

async function runAxe(doc: Document) {
  return axe.run(doc.body, {
    // color-contrast can't be evaluated in jsdom (no layout/canvas), and contrast is
    // owned by globals.css + the e2e/Playwright axe pass, so disable just that rule.
    rules: { 'color-contrast': { enabled: false } },
  });
}

test('populated run list has zero axe violations', async () => {
  const results = await runAxe(render(SAMPLE_RUNS));
  assert.deepEqual(
    results.violations.map((v) => v.id),
    [],
    `axe violations: ${JSON.stringify(results.violations.map((v) => v.id))}`,
  );
});

test('empty run list has zero axe violations', async () => {
  const results = await runAxe(render([]));
  assert.deepEqual(results.violations.map((v) => v.id), []);
});

test('table is semantically structured: caption + column headers', () => {
  const doc = render(SAMPLE_RUNS);
  assert.equal(doc.querySelector('table > caption')?.textContent, 'Launches');
  const headers = [...doc.querySelectorAll('thead th[scope="col"]')].map((h) => h.textContent);
  assert.deepEqual(headers, ['Launch', 'Trigger', 'Status', 'Next action', 'Started']);
});

test('runs awaiting review sort to the top with a direct next-action link', () => {
  // A completed run first in the input, an awaiting run second — the awaiting run must surface
  // first and expose a link straight to its gate (the action-oriented ordering, UI tier-1 #3).
  const awaitingRun: ReleaseRun = {
    ...SAMPLE_RUNS[0]!,
    id: 'cccccccc-1111-2222-3333-444444444444',
    status: 'features_pending_review',
  };
  const doc = render([SAMPLE_RUNS[0]!, awaitingRun]);
  const firstRowStatus = doc
    .querySelector('tbody tr td[data-status]')
    ?.getAttribute('data-status');
  assert.equal(firstRowStatus, 'features_pending_review', 'awaiting run sorts first');
  const action = doc.querySelector('td[data-next-action="pending"] a[href]');
  assert.equal(action?.getAttribute('href'), `/releases/${awaitingRun.id}/review`);
});

test('status is conveyed as humanized text, not colour alone', () => {
  const doc = render(SAMPLE_RUNS);
  // Raw enum stays on data-status; the visible label is humanized.
  const rawStatuses = [...doc.querySelectorAll('td[data-status]')].map((s) =>
    s.getAttribute('data-status'),
  );
  assert.deepEqual(rawStatuses, ['completed', 'collecting_evidence']);
  const statuses = [...doc.querySelectorAll('td[data-status] span')].map((s) => s.textContent);
  assert.deepEqual(statuses, ['Completed', 'Collecting evidence']);
});

test('each run links to its detail route (keyboard-focusable)', () => {
  const doc = render(SAMPLE_RUNS);
  const links = [...doc.querySelectorAll('tbody a[href]')].map((a) => a.getAttribute('href'));
  assert.deepEqual(links, [
    '/releases/aaaaaaaa-1111-2222-3333-444444444444',
    '/releases/bbbbbbbb-1111-2222-3333-444444444444',
  ]);
});
