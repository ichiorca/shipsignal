// UI tier-1 #1 — AC: the "Awaiting your review" queue is WCAG 2.2 AA and surfaces the runs that
// need a human, each linking straight to its gate. Renders the real ReviewQueue to static markup,
// runs axe in jsdom, and asserts the queue filters/links correctly.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import axe from 'axe-core';
import { ReviewQueue } from '../app/components/ReviewQueue.ts';
import type { ReleaseRun } from '../app/lib/db/releaseRuns.ts';

function run(overrides: Partial<ReleaseRun>): ReleaseRun {
  return {
    id: 'aaaaaaaa-1111-2222-3333-444444444444',
    repo: 'org/product',
    base_ref: 'v1.0',
    head_ref: 'v1.1',
    trigger_type: 'manual',
    status: 'completed',
    artifact_types: ['release_blog'],
    langgraph_thread_id: null,
    started_at: '2026-06-07T10:00:00.000Z',
    completed_at: null,
    ...overrides,
  };
}

function render(runs: readonly ReleaseRun[]): Document {
  const html = renderToStaticMarkup(
    createElement('main', { id: 'main' }, createElement(ReviewQueue, { runs })),
  );
  return new JSDOM(`<!doctype html><html lang="en"><body>${html}</body></html>`).window.document;
}

test('review queue has zero axe violations (populated and empty)', async () => {
  const populated = await axe.run(
    render([run({ id: 'cccccccc-1111-2222-3333-444444444444', status: 'features_pending_review' })]).body,
    { rules: { 'color-contrast': { enabled: false } } },
  );
  assert.deepEqual(populated.violations.map((v) => v.id), []);
  const empty = await axe.run(render([run({ status: 'completed' })]).body, {
    rules: { 'color-contrast': { enabled: false } },
  });
  assert.deepEqual(empty.violations.map((v) => v.id), []);
});

test('only runs awaiting a gate appear, each with a direct CTA to that gate', () => {
  const awaiting = run({
    id: 'cccccccc-1111-2222-3333-444444444444',
    status: 'artifacts_pending_review',
  });
  const notAwaiting = run({ id: 'dddddddd-1111-2222-3333-444444444444', status: 'generating_artifacts' });
  const doc = render([awaiting, notAwaiting]);
  const items = [...doc.querySelectorAll('[data-queue-list] li')];
  assert.equal(items.length, 1, 'only the awaiting run is queued');
  assert.equal(items[0]?.getAttribute('data-run-id'), awaiting.id);
  const cta = items[0]?.querySelector('a[data-queue-cta]');
  assert.equal(cta?.getAttribute('href'), `/releases/${awaiting.id}/artifacts/review`);
});

test('the section is labelled and shows a friendly empty state when nothing is pending', () => {
  const doc = render([run({ status: 'completed' })]);
  const section = doc.querySelector('[data-review-queue]');
  assert.equal(section?.getAttribute('aria-labelledby'), 'review-queue-heading');
  assert.equal(doc.querySelector('[data-queue-list]'), null, 'no list when nothing is pending');
  assert.match(doc.querySelector('[data-review-queue] p')?.textContent ?? '', /Nothing is waiting/i);
});
