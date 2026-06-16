// Path B / Phase 4 — AC: the Distribute schedule queue passes axe/keyboard checks (WCAG 2.2 AA),
// is a semantic captioned table, and conveys status as text.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import axe from 'axe-core';
import { ScheduleQueue } from '../app/components/ScheduleQueue.ts';
import type { ScheduledPublishView } from '../app/lib/scheduledPublish.ts';

const ROWS: readonly ScheduledPublishView[] = [
  {
    id: 'sch-1',
    artifact_id: 'art-1',
    release_run_id: 'run-1',
    channel: 'x',
    scheduled_at: '2026-06-16T15:00:00.000Z',
    status: 'pending',
    attempt_count: 0,
    last_error: null,
    published_url: null,
  },
  {
    id: 'sch-2',
    artifact_id: 'art-2',
    release_run_id: 'run-1',
    channel: 'linkedin',
    scheduled_at: '2026-06-15T15:00:00.000Z',
    status: 'failed',
    attempt_count: 1,
    last_error: 'upstream 500',
    published_url: null,
  },
];

function render(rows: readonly ScheduledPublishView[]): Document {
  const html = renderToStaticMarkup(
    createElement('main', { id: 'main' }, createElement(ScheduleQueue, { schedules: rows })),
  );
  return new JSDOM(`<!doctype html><html lang="en"><body>${html}</body></html>`).window.document;
}

test('populated schedule queue has zero axe violations', async () => {
  const results = await axe.run(render(ROWS).body, { rules: { 'color-contrast': { enabled: false } } });
  assert.deepEqual(
    results.violations.map((v) => v.id),
    [],
    `axe violations: ${JSON.stringify(results.violations.map((v) => v.id))}`,
  );
});

test('empty schedule queue has zero axe violations and an empty-state message', async () => {
  const doc = render([]);
  const results = await axe.run(doc.body, { rules: { 'color-contrast': { enabled: false } } });
  assert.deepEqual(results.violations.map((v) => v.id), []);
  assert.match(doc.querySelector('tbody td')?.textContent ?? '', /No posts scheduled/);
});

test('is a captioned table; status renders as humanized text', () => {
  const doc = render(ROWS);
  assert.equal(doc.querySelector('table > caption')?.textContent, 'Scheduled posts');
  const statuses = [...doc.querySelectorAll('td[data-status] span')].map((s) => s.textContent);
  assert.equal(statuses[0], 'Pending');
  assert.ok(statuses.some((s) => s?.startsWith('Failed')));
});
