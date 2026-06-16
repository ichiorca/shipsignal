// T1 (spec 014) — AC: the demo-generation trigger is WCAG 2.2 AA. Renders the real
// GenerateDemoButton to static markup, runs axe in jsdom, and asserts: zero axe violations, the
// group is labelled for the feature, the reviewer field is a real <input> with an associated
// <label>, the trigger is a real <button>, and the async result has a polite live region.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import axe from 'axe-core';
import { GenerateDemoButton } from '../app/components/GenerateDemoButton.ts';

const FEATURE_ID = 'feat1111-1111-2222-3333-444444444444';

function render(): Document {
  const html = renderToStaticMarkup(
    createElement(
      'main',
      { id: 'main' },
      createElement('h1', null, 'Demo media'),
      createElement(GenerateDemoButton, {
        featureId: FEATURE_ID,
        featureLabel: 'Reusable onboarding checklists',
      }),
    ),
  );
  return new JSDOM(`<!doctype html><html lang="en"><body>${html}</body></html>`).window
    .document;
}

test('generate-demo trigger has zero axe violations', async () => {
  const results = await axe.run(render().body, {
    rules: { 'color-contrast': { enabled: false } },
  });
  assert.deepEqual(
    results.violations.map((v) => v.id),
    [],
    `axe violations: ${JSON.stringify(results.violations.map((v) => v.id))}`,
  );
});

test('the trigger is a group labelled for the feature', () => {
  const group = render().querySelector(`[data-generate-demo="${FEATURE_ID}"]`);
  assert.equal(group?.getAttribute('role'), 'group');
  assert.equal(
    group?.getAttribute('aria-label'),
    'Generate demo media for Reusable onboarding checklists',
  );
});

test('the reviewer field is a labelled input and the trigger is a real button', () => {
  const doc = render();
  const input = doc.querySelector(`[data-generate-demo="${FEATURE_ID}"] input`);
  const label = doc.querySelector(
    `label[for="${input?.getAttribute('id')}"]`,
  );
  assert.ok(input, 'reviewer input present');
  assert.ok(label, 'reviewer input has an associated label');

  const button = doc.querySelector(`[data-generate-demo="${FEATURE_ID}"] button`);
  assert.equal(button?.getAttribute('type'), 'button');
  assert.equal(button?.textContent, 'Generate demo media');
});

test('the result has a polite live-region status', () => {
  const statusEl = render().querySelector(
    `[data-generate-demo="${FEATURE_ID}"] [role="status"]`,
  );
  assert.ok(statusEl, 'status region present');
  assert.equal(statusEl?.getAttribute('aria-live'), 'polite');
});
