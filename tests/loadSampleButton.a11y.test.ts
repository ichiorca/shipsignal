// Operator feedback 2026-06-09 — AC: the sample-release seeder is WCAG 2.2 AA. Renders the
// real LoadSampleButton, runs axe in jsdom, and asserts: zero violations, a real <button>,
// the section is labelled by its heading, and a polite live region exists for the result.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import axe from 'axe-core';
import { LoadSampleButton } from '../app/components/LoadSampleButton.ts';

function render(): Document {
  const html = renderToStaticMarkup(
    createElement(
      'main',
      { id: 'main' },
      createElement('h1', null, 'Release runs'),
      createElement(LoadSampleButton, null),
    ),
  );
  return new JSDOM(`<!doctype html><html lang="en"><body>${html}</body></html>`).window
    .document;
}

test('the sample-release section has zero axe violations', async () => {
  const results = await axe.run(render().body, {
    rules: { 'color-contrast': { enabled: false } },
  });
  assert.deepEqual(
    results.violations.map((v) => v.id),
    [],
    `axe violations: ${JSON.stringify(results.violations.map((v) => v.id))}`,
  );
});

test('a real labelled button and a polite live region are present', () => {
  const doc = render();
  const section = doc.querySelector('section[aria-labelledby="sample-release-heading"]');
  assert.ok(section, 'the section is labelled by its heading');
  const button = doc.querySelector('[data-sample-release] button[type="button"]');
  assert.equal(button?.textContent, 'Load sample release');
  assert.ok(doc.querySelector('[data-sample-release] [role="status"][aria-live="polite"]'));
});
