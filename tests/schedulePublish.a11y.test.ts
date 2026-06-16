// Path B / Phase 4 — AC: the schedule control passes axe/keyboard checks (WCAG 2.2 AA), exposes a
// labelled datetime + reviewer input, renders nothing for a non-schedulable type, and explains
// itself when scheduling is off.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import axe from 'axe-core';
import { SchedulePublish, type SchedulePublishProps } from '../app/components/SchedulePublish.ts';

function render(overrides: Partial<SchedulePublishProps>): Document {
  const props: SchedulePublishProps = {
    artifactId: 'art-1',
    artifactType: 'x_post',
    schedulingEnabled: true,
    suggestedTimeIso: '2026-06-16T15:00:00.000Z',
    schedules: [],
    ...overrides,
  };
  const html = renderToStaticMarkup(
    createElement('main', { id: 'main' }, createElement('h1', null, 'Post'), createElement(SchedulePublish, props)),
  );
  return new JSDOM(`<!doctype html><html lang="en"><body>${html}</body></html>`).window.document;
}

test('enabled schedule control has zero axe violations and labelled inputs', async () => {
  const doc = render({});
  const results = await axe.run(doc.body, { rules: { 'color-contrast': { enabled: false } } });
  assert.deepEqual(
    results.violations.map((v) => v.id),
    [],
    `axe violations: ${JSON.stringify(results.violations.map((v) => v.id))}`,
  );
  assert.ok(doc.querySelector('label[for="schedule-time-art-1"]'));
  assert.equal(doc.querySelector('#schedule-time-art-1')?.getAttribute('type'), 'datetime-local');
  assert.ok(doc.querySelector('label[for="schedule-reviewer-art-1"]'));
  assert.match(doc.querySelector('button')?.textContent ?? '', /Schedule post/);
});

test('a non-schedulable artifact type renders nothing', () => {
  const doc = render({ artifactType: 'release_blog' });
  assert.equal(doc.querySelector('[data-schedule-publish]'), null);
});

test('a hackernews_post (assisted only) renders nothing', () => {
  assert.equal(render({ artifactType: 'hackernews_post' }).querySelector('[data-schedule-publish]'), null);
});

test('when scheduling is off, the control explains how to enable it', () => {
  const doc = render({ schedulingEnabled: false });
  assert.match(doc.body.textContent ?? '', /PUBLISH_MODE=scheduled/);
  assert.equal(doc.querySelector('input'), null, 'no form inputs when disabled');
});

test('an existing pending schedule shows a Reschedule action and a cancel button', () => {
  const doc = render({
    schedules: [
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
    ],
  });
  const buttons = [...doc.querySelectorAll('button')].map((b) => b.textContent);
  assert.ok(buttons.includes('Reschedule'));
  assert.ok(buttons.includes('Cancel schedule'));
});
