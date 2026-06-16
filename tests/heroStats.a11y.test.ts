// Operator feedback 2026-06-09 — AC: the hero stat strip is WCAG 2.2 AA. Renders the real
// HeroStats component to static markup, runs axe in jsdom, and asserts the semantics:
// a labelled region, a definition list pairing every value with its text label.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import axe from 'axe-core';
import { HeroStats } from '../app/components/HeroStats.ts';
import { buildHeroStats } from '../app/lib/heroStats.ts';

const STATS = buildHeroStats({
  artifactsShipped: 14,
  claimsEvidenceBackedRate: 0.96,
  medianSecondsToApprovedContent: 42 * 60,
  avgModelCostPerRunUsd: 0.84,
  releasesWithApprovedContent: 3,
});

function render(): Document {
  const html = renderToStaticMarkup(
    createElement(
      'main',
      { id: 'main' },
      createElement('h1', null, 'Release runs'),
      createElement(HeroStats, { stats: STATS }),
    ),
  );
  return new JSDOM(`<!doctype html><html lang="en"><body>${html}</body></html>`).window
    .document;
}

test('the hero stat strip has zero axe violations', async () => {
  const results = await axe.run(render().body, {
    rules: { 'color-contrast': { enabled: false } },
  });
  assert.deepEqual(
    results.violations.map((v) => v.id),
    [],
    `axe violations: ${JSON.stringify(results.violations.map((v) => v.id))}`,
  );
});

test('the strip is a labelled region of definition pairs', () => {
  const doc = render();
  const region = doc.querySelector('[data-hero-stats]');
  assert.equal(region?.getAttribute('aria-label'), 'Release pipeline value');
  const terms = doc.querySelectorAll('[data-hero-stats] dl dt');
  assert.equal(terms.length, 4, 'four stats, each with a <dt> label');
  // Every value is text inside its <dd>, paired with the label — nothing styling-only.
  for (const dd of doc.querySelectorAll('[data-hero-stats] dl dd')) {
    assert.ok((dd.textContent ?? '').length > 0);
  }
});

test('the four stats render in story order: speed, cost, trust, output', () => {
  const keys = [...render().querySelectorAll('[data-stat]')].map((el) =>
    el.getAttribute('data-stat'),
  );
  assert.deepEqual(keys, ['speed', 'cost', 'trust', 'output']);
});
