// T4 (spec 021) — AC: the engagement CSV upload panel is WCAG 2.2 AA and keyboard-operable.
// Renders the real EngagementCsvUpload (the same component the cost page composes) to
// static markup, runs axe over it in jsdom, and asserts the structure keyboard/screen-
// reader users rely on: zero axe violations, a labelled file input pointing at its hint,
// real <button>s (template download + submit), and a polite live region for the row-level
// feedback. GDPR rails: the panel's copy announces aggregate-only ingestion.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import axe from 'axe-core';
import { EngagementCsvUpload } from '../app/components/EngagementCsvUpload.ts';

const ARTIFACTS = [
  { id: 'aaaaaaaa-1111-2222-3333-444444444444', artifact_type: 'release_blog' },
  { id: 'bbbbbbbb-1111-2222-3333-444444444444', artifact_type: 'changelog' },
] as const;

function render(): Document {
  // Wrap in <main> + <h1> so axe sees the panel's <h2> inside a landmark + heading order,
  // mirroring app/releases/[id]/cost/page.tsx.
  const html = renderToStaticMarkup(
    createElement(
      'main',
      { id: 'main' },
      createElement('h1', null, 'Model cost & latency'),
      createElement(EngagementCsvUpload, {
        releaseRunId: 'rrrrrrrr-1111-2222-3333-444444444444',
        artifacts: ARTIFACTS,
      }),
    ),
  );
  return new JSDOM(`<!doctype html><html lang="en"><body>${html}</body></html>`).window
    .document;
}

async function runAxe(doc: Document) {
  // color-contrast can't be evaluated in jsdom (no layout); covered by the e2e axe pass.
  return axe.run(doc.body, { rules: { 'color-contrast': { enabled: false } } });
}

test('the upload panel has zero axe violations', async () => {
  const results = await runAxe(render());
  assert.deepEqual(
    results.violations.map((v) => v.id),
    [],
    `axe violations: ${JSON.stringify(results.violations.map((v) => v.id))}`,
  );
});

test('the file input is labelled and points at its describing hint', () => {
  const doc = render();
  const input = doc.getElementById('engagement-csv');
  assert.ok(input, 'the file input exists');
  assert.equal(input?.getAttribute('type'), 'file');
  assert.ok(doc.querySelector('label[for="engagement-csv"]'), 'the input has a label');
  assert.equal(input?.getAttribute('aria-describedby'), 'engagement-csv-hint');
  assert.match(
    doc.getElementById('engagement-csv-hint')?.textContent ?? '',
    /artifact_id, metric/,
  );
});

test('template download and submit are real buttons; feedback has a polite live region', () => {
  const doc = render();
  const buttons = [...doc.querySelectorAll('button')].map((b) => b.textContent);
  assert.ok(buttons.includes('Download CSV template'));
  assert.ok(buttons.includes('Upload engagement CSV'));
  assert.ok(doc.querySelector('form button[type="submit"]'), 'submit lives in the form');
  assert.ok(
    doc.querySelector('[role="status"][aria-live="polite"]'),
    'a polite live region is present for feedback',
  );
});

test('the section is labelled by its heading and announces aggregate-only ingestion', () => {
  const doc = render();
  const section = doc.querySelector('section[aria-labelledby="engagement-upload-heading"]');
  assert.ok(section, 'the panel section exists');
  assert.equal(doc.getElementById('engagement-upload-heading')?.tagName, 'H2');
  assert.match(section?.textContent ?? '', /No user-level data is accepted/);
});
