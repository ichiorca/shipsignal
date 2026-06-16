// Frontend audit — unit tests for the pure run-feed filter + pagination logic, plus an axe/a11y
// pass over the interactive RunFeed wrapper (search form labels, live count, paginator buttons).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import axe from 'axe-core';
import { filterRuns, paginate } from '../app/lib/runFeedFilter.ts';
import { RunFeed } from '../app/components/RunFeed.ts';
import type { ReleaseRun } from '../app/lib/db/releaseRuns.ts';

function makeRun(overrides: Partial<ReleaseRun>): ReleaseRun {
  return {
    id: 'aaaaaaaa-1111-2222-3333-444444444444',
    repo: 'org/product',
    base_ref: 'v1.0.0',
    head_ref: 'v1.1.0',
    trigger_type: 'manual',
    status: 'completed',
    artifact_types: ['release_blog'],
    langgraph_thread_id: null,
    started_at: '2026-06-07T10:00:00.000Z',
    completed_at: null,
    ...overrides,
  };
}

const RUNS: readonly ReleaseRun[] = [
  makeRun({ id: 'run-1', repo: 'org/alpha', status: 'completed' }),
  makeRun({ id: 'run-2', repo: 'org/beta', status: 'features_pending_review' }),
  makeRun({ id: 'run-3', repo: 'org/alpha', status: 'collecting_evidence' }),
  makeRun({ id: 'run-4', repo: 'org/gamma', status: 'failed' }),
];

test('filterRuns matches free text across repo and id', () => {
  assert.deepEqual(
    filterRuns(RUNS, { query: 'beta', status: 'all' }).map((r) => r.id),
    ['run-2'],
  );
  assert.deepEqual(
    filterRuns(RUNS, { query: 'run-3', status: 'all' }).map((r) => r.id),
    ['run-3'],
  );
  // Empty query returns everything.
  assert.equal(filterRuns(RUNS, { query: '', status: 'all' }).length, 4);
});

test('filterRuns filters by status bucket', () => {
  assert.deepEqual(
    filterRuns(RUNS, { query: '', status: 'awaiting' }).map((r) => r.id),
    ['run-2'],
  );
  assert.deepEqual(
    filterRuns(RUNS, { query: '', status: 'failed' }).map((r) => r.id),
    ['run-4'],
  );
  assert.deepEqual(
    filterRuns(RUNS, { query: '', status: 'in_progress' }).map((r) => r.id),
    ['run-3'],
  );
});

test('filter combines query AND status', () => {
  assert.deepEqual(
    filterRuns(RUNS, { query: 'alpha', status: 'done' }).map((r) => r.id),
    ['run-1'],
  );
});

test('paginate slices and reports page metadata', () => {
  const items = [1, 2, 3, 4, 5];
  const p1 = paginate(items, 1, 2);
  assert.deepEqual(p1.items, [1, 2]);
  assert.equal(p1.pageCount, 3);
  assert.equal(p1.total, 5);
  const p3 = paginate(items, 3, 2);
  assert.deepEqual(p3.items, [5]);
});

test('paginate clamps an out-of-range page into range', () => {
  const items = [1, 2, 3];
  // Filter shrank the set; an over-range page must clamp, never strand on empty.
  assert.deepEqual(paginate(items, 9, 2).items, [3]);
  assert.equal(paginate(items, 9, 2).page, 2);
  assert.deepEqual(paginate([], 1, 2).items, []);
  assert.equal(paginate([], 1, 2).pageCount, 1);
});

function render(runs: readonly ReleaseRun[], pageSize?: number): Document {
  const props = pageSize === undefined ? { runs } : { runs, pageSize };
  const html = renderToStaticMarkup(
    createElement('main', { id: 'main' }, createElement(RunFeed, props)),
  );
  return new JSDOM(`<!doctype html><html lang="en"><body>${html}</body></html>`).window.document;
}

test('RunFeed has zero axe violations and labelled search controls', async () => {
  const doc = render(RUNS);
  const results = await axe.run(doc.body, { rules: { 'color-contrast': { enabled: false } } });
  assert.deepEqual(
    results.violations.map((v) => v.id),
    [],
    `axe violations: ${JSON.stringify(results.violations.map((v) => v.id))}`,
  );
  // Both controls are programmatically labelled.
  assert.ok(doc.querySelector('label[for="run-search"]'));
  assert.ok(doc.querySelector('label[for="run-status-filter"]'));
  assert.equal(doc.querySelector('form[role="search"]') !== null, true);
});

test('RunFeed renders a live result count', () => {
  const doc = render(RUNS);
  const count = doc.querySelector('[data-run-count][role="status"]')?.textContent ?? '';
  assert.match(count, /Showing 4 of 4 runs/);
});

test('RunFeed shows a paginator only when more than one page', () => {
  assert.equal(render(RUNS, 2).querySelector('[data-run-paginator]') !== null, true);
  assert.equal(render(RUNS, 20).querySelector('[data-run-paginator]'), null);
});
