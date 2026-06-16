// Operator feedback 2026-06-09 — AC: the learning-trends view is WCAG 2.2 AA. Renders the
// real LearningTrends component, runs axe in jsdom, and asserts: zero violations, captioned
// tables carry the data, trend direction is stated as TEXT, and the sparklines are
// decorative (aria-hidden) so the drawing is never the sole carrier.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import axe from 'axe-core';
import { LearningTrends } from '../app/components/LearningTrends.ts';
import type { RunTrendPoint, SkillPromotionPoint } from '../app/lib/learningTrends.ts';

const POINTS: readonly RunTrendPoint[] = [
  {
    release_run_id: 'aaaaaaaa-1111-2222-3333-444444444444',
    started_at: '2026-05-01T10:00:00.000Z',
    edit_distance: 0.42,
    feature_rejection_rate: 0.3,
  },
  {
    release_run_id: 'bbbbbbbb-1111-2222-3333-444444444444',
    started_at: '2026-05-15T10:00:00.000Z',
    edit_distance: 0.25,
    feature_rejection_rate: null,
  },
  {
    release_run_id: 'cccccccc-1111-2222-3333-444444444444',
    started_at: '2026-06-01T10:00:00.000Z',
    edit_distance: 0.12,
    feature_rejection_rate: 0.1,
  },
];

const PROMOTIONS: readonly SkillPromotionPoint[] = [
  { skill_name: 'blog-format', proposed_version: '2.1.0', reviewed_at: '2026-05-20T12:00:00.000Z' },
];

function render(points: readonly RunTrendPoint[] = POINTS): Document {
  const html = renderToStaticMarkup(
    createElement(
      'main',
      { id: 'main' },
      createElement('h1', null, 'Learning trends'),
      createElement(LearningTrends, { points, promotions: PROMOTIONS }),
    ),
  );
  return new JSDOM(`<!doctype html><html lang="en"><body>${html}</body></html>`).window
    .document;
}

test('the trends view has zero axe violations', async () => {
  const results = await axe.run(render().body, {
    rules: { 'color-contrast': { enabled: false } },
  });
  assert.deepEqual(
    results.violations.map((v) => v.id),
    [],
    `axe violations: ${JSON.stringify(results.violations.map((v) => v.id))}`,
  );
});

test('both data tables are captioned; unmeasured cells render an em dash', () => {
  const doc = render();
  const captions = [...doc.querySelectorAll('caption')].map((c) => c.textContent);
  assert.ok(captions.some((c) => c?.includes('Per-run learning metrics')));
  assert.ok(captions.some((c) => c?.includes('Promoted skill versions')));
  assert.ok([...doc.querySelectorAll('td')].some((td) => td.textContent === '—'));
});

test('trend direction is stated as text and the sparkline is decorative', () => {
  const doc = render();
  const headline = doc.querySelector('[data-trend-headline="edit_distance"]');
  assert.equal(headline?.getAttribute('data-direction'), 'improving');
  assert.ok(headline?.textContent?.includes('fell'));
  for (const svg of doc.querySelectorAll('svg')) {
    assert.equal(svg.getAttribute('aria-hidden'), 'true');
  }
});

test('an empty series degrades to honest guidance, not a fake chart', () => {
  const doc = render([]);
  assert.ok(doc.body.textContent?.includes('not enough measured runs'));
  assert.ok(doc.body.textContent?.includes('No evaluated runs yet'));
  assert.equal(doc.querySelectorAll('svg').length, 0);
});
