// UI tier-2 #7 — AC: the status legend is WCAG 2.2 AA and names each category as text.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import axe from 'axe-core';
import { StatusLegend } from '../app/components/StatusLegend.ts';

function render(): Document {
  const html = renderToStaticMarkup(createElement('main', { id: 'main' }, createElement(StatusLegend)));
  return new JSDOM(`<!doctype html><html lang="en"><body>${html}</body></html>`).window.document;
}

test('status legend has zero axe violations', async () => {
  const results = await axe.run(render().body, { rules: { 'color-contrast': { enabled: false } } });
  assert.deepEqual(results.violations.map((v) => v.id), []);
});

test('the legend is a labelled group naming all four categories as text', () => {
  const doc = render();
  const group = doc.querySelector('[data-status-legend]');
  assert.equal(group?.getAttribute('role'), 'group');
  assert.equal(group?.getAttribute('aria-label'), 'Status legend');
  const labels = [...doc.querySelectorAll('[data-status-legend] [data-status-category]')].map(
    (s) => s.textContent,
  );
  assert.deepEqual(labels, ['Awaiting you', 'In progress', 'Done', 'Failed / cancelled']);
});
