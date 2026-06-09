// T2/T5 (spec 019) — AC: the export actions for an approved artifact are WCAG 2.2 AA. Renders
// the real ArtifactExportActions to static markup, runs axe in jsdom, and asserts: zero axe
// violations, the group is labelled for the artifact, copy is a REAL <button> and the downloads
// are REAL <a href> links (native keyboard operability), the links target the snapshot export
// API, and the async copy status has a polite live region.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import axe from 'axe-core';
import { ArtifactExportActions } from '../app/components/ArtifactExportActions.ts';

const ARTIFACT_ID = 'art11111-1111-2222-3333-444444444444';

function render(): Document {
  const html = renderToStaticMarkup(
    createElement(
      'main',
      { id: 'main' },
      createElement('h1', null, 'Review artifacts (Gate #2)'),
      createElement(ArtifactExportActions, {
        artifactId: ARTIFACT_ID,
        artifactLabel: 'Onboarding checklists',
      }),
    ),
  );
  return new JSDOM(`<!doctype html><html lang="en"><body>${html}</body></html>`).window
    .document;
}

test('export actions have zero axe violations', async () => {
  const results = await axe.run(render().body, {
    rules: { 'color-contrast': { enabled: false } },
  });
  assert.deepEqual(
    results.violations.map((v) => v.id),
    [],
    `axe violations: ${JSON.stringify(results.violations.map((v) => v.id))}`,
  );
});

test('the actions are a group labelled for the artifact', () => {
  const group = render().querySelector(`[data-export-actions="${ARTIFACT_ID}"]`);
  assert.equal(group?.getAttribute('role'), 'group');
  assert.equal(group?.getAttribute('aria-label'), 'Export Onboarding checklists');
});

test('copy is a real button; downloads are real links to the export API', () => {
  const doc = render();
  const button = doc.querySelector(`[data-export-actions="${ARTIFACT_ID}"] button`);
  assert.equal(button?.getAttribute('type'), 'button');
  assert.equal(button?.textContent, 'Copy Markdown');

  const hrefs = [...doc.querySelectorAll(`[data-export-actions="${ARTIFACT_ID}"] a`)].map((a) =>
    a.getAttribute('href'),
  );
  assert.deepEqual(hrefs, [
    `/api/artifacts/${ARTIFACT_ID}/export?format=markdown`,
    `/api/artifacts/${ARTIFACT_ID}/export?format=html`,
    `/api/artifacts/${ARTIFACT_ID}/export?format=json`,
  ]);
});

test('the copy result has a polite live-region status', () => {
  const statusEl = render().querySelector(`[data-export-actions="${ARTIFACT_ID}"] [role="status"]`);
  assert.ok(statusEl, 'status region present');
  assert.equal(statusEl?.getAttribute('aria-live'), 'polite');
});
