// UX review R10 — the conversion funnel is WCAG 2.2 AA. Renders the real ConversionFunnel in
// jsdom, runs axe, and asserts: zero violations, a labelled section, each stage's count is TEXT
// (the bar is aria-hidden, so meaning never rests on the bar width alone), and an honest empty
// state when nothing has been generated.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import axe from 'axe-core';
import { ConversionFunnel } from '../app/components/ConversionFunnel.ts';

function render(counts: {
  generated: number;
  approved: number;
  published: number;
  engaged: number;
}): Document {
  const html = renderToStaticMarkup(
    createElement('main', { id: 'main' }, createElement(ConversionFunnel, { counts })),
  );
  return new JSDOM(`<!doctype html><html lang="en"><body>${html}</body></html>`).window
    .document;
}

const POPULATED = { generated: 20, approved: 10, published: 5, engaged: 2 };

test('the funnel has zero axe violations', async () => {
  const results = await axe.run(render(POPULATED).body, {
    rules: { 'color-contrast': { enabled: false } },
  });
  assert.deepEqual(
    results.violations.map((v) => v.id),
    [],
    `axe violations: ${JSON.stringify(results.violations.map((v) => v.id))}`,
  );
});

test('each stage renders its count as text and the bar is aria-hidden', () => {
  const doc = render(POPULATED);
  assert.ok(doc.querySelector('section[aria-labelledby="funnel-heading"]'), 'labelled section');
  const stages = doc.querySelectorAll('[data-funnel-stage]');
  assert.equal(stages.length, 4, 'four stages render');
  const counts = [...doc.querySelectorAll('[data-funnel-count]')].map((n) =>
    (n.textContent ?? '').trim(),
  );
  assert.ok(counts[0]?.startsWith('20'), 'top stage count is text');
  assert.ok(counts[1]?.includes('50% of previous'), 'stage conversion is text');
  for (const bar of doc.querySelectorAll('[data-funnel-bar]')) {
    assert.equal(bar.getAttribute('aria-hidden'), 'true', 'the bar is decorative');
  }
});

test('an empty deployment shows an honest empty state, not a zero funnel', () => {
  const doc = render({ generated: 0, approved: 0, published: 0, engaged: 0 });
  assert.equal(doc.querySelector('[data-funnel-stages]'), null, 'no funnel bars');
  assert.match(doc.body.textContent ?? '', /No content yet/);
});
