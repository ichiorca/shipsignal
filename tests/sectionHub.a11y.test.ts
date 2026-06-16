// Path B / Phase 1 — AC: the job-based section hubs pass axe/keyboard checks (WCAG 2.2 AA), expose
// real keyboard-focusable links for live areas, and render roadmap ("soon") cards as
// non-interactive text rather than dead links. Renders the real SectionHub (the same component the
// Distribute/Measure/Admin pages compose) to static markup and runs axe-core in jsdom.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import axe from 'axe-core';
import { SectionHub, type HubCard } from '../app/components/SectionHub.ts';

const CARDS: readonly HubCard[] = [
  { title: 'Published & deliveries', description: 'What shipped and where.', href: '/webhooks' },
  { title: 'Channels', description: 'Connect LinkedIn and X.', soon: true },
];

function render(): Document {
  const html = renderToStaticMarkup(
    createElement(
      'main',
      { id: 'main' },
      createElement(SectionHub, { title: 'Distribute', intro: 'Get launches in front of your audience.', cards: CARDS }),
    ),
  );
  return new JSDOM(`<!doctype html><html lang="en"><body>${html}</body></html>`).window.document;
}

test('section hub has zero axe violations', async () => {
  const results = await axe.run(render().body, { rules: { 'color-contrast': { enabled: false } } });
  assert.deepEqual(
    results.violations.map((v) => v.id),
    [],
    `axe violations: ${JSON.stringify(results.violations.map((v) => v.id))}`,
  );
});

test('a live card exposes a keyboard-focusable link; a soon card does not', () => {
  const doc = render();
  // Live card → real link.
  const live = doc.querySelector('li[data-hub-card]:not([data-soon]) h2 a[href]');
  assert.equal(live?.getAttribute('href'), '/webhooks');
  // Soon card → marked, no link, shows the "Coming soon" affordance.
  const soon = doc.querySelector('li[data-hub-card][data-soon]');
  assert.ok(soon);
  assert.equal(soon?.querySelector('a'), null, 'soon card has no dead link');
  assert.match(soon?.textContent ?? '', /Coming soon/);
});

test('the hub heading is the page h1', () => {
  assert.equal(render().querySelector('h1')?.textContent, 'Distribute');
});
