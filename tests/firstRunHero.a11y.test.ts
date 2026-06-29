// UX review R9 — the empty-state hero is WCAG 2.2 AA. Renders the real FirstRunHero (+ the
// SampleDataNotice) in jsdom, runs axe, and asserts the structural contract: zero violations, a
// labelled section led by a heading, the value props as a list, the seed button + a real link to
// /draft, and that the sample-data notice carries a TEXT label (never colour alone).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import axe from 'axe-core';
import { FirstRunHero } from '../app/components/FirstRunHero.ts';
import { SampleDataNotice } from '../app/components/SampleDataNotice.ts';

function render(showNotice: boolean): Document {
  const html = renderToStaticMarkup(
    createElement(
      'main',
      { id: 'main' },
      createElement('h1', null, 'Founder Dashboard'),
      createElement(SampleDataNotice, { show: showNotice }),
      createElement(FirstRunHero, null),
    ),
  );
  return new JSDOM(`<!doctype html><html lang="en"><body>${html}</body></html>`).window
    .document;
}

test('the first-run hero has zero axe violations', async () => {
  const results = await axe.run(render(true).body, {
    rules: { 'color-contrast': { enabled: false } },
  });
  assert.deepEqual(
    results.violations.map((v) => v.id),
    [],
    `axe violations: ${JSON.stringify(results.violations.map((v) => v.id))}`,
  );
});

test('the hero is a labelled section with value props, a seed button, and a /draft link', () => {
  const doc = render(false);
  const hero = doc.querySelector('section[aria-labelledby="first-run-hero-heading"]');
  assert.ok(hero, 'the hero is labelled by its heading');
  assert.ok(doc.querySelector('[data-hero-points] li'), 'value props render as a list');
  assert.ok(doc.querySelector('[data-sample-release] button'), 'the seed button is present');
  const draftLink = doc.querySelector('[data-hero-secondary] a[href="/draft"]');
  assert.ok(draftLink, 'a real link to /draft is offered as the secondary path');
});

test('SampleDataNotice renders a TEXT tag when shown and nothing when hidden', () => {
  const shown = render(true);
  const tag = shown.querySelector('[data-sample-data-notice] [data-sample-tag]');
  assert.equal(tag?.textContent, 'Sample data', 'the notice carries a text label, not colour alone');

  const hidden = render(false);
  assert.equal(
    hidden.querySelector('[data-sample-data-notice]'),
    null,
    'the notice renders nothing when there is no synthetic data',
  );
});
