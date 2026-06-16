// AC: the start-a-run form is WCAG 2.2 AA. Renders the real NewReleaseRunForm (the same
// component the home page composes) to static markup, runs axe over it in jsdom, and
// asserts the structure keyboard/screen-reader users rely on: zero axe violations, every
// input is labelled and describes its hint, the submit is a real <button>, and there is a
// polite live region for feedback.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import axe from 'axe-core';
import { NewReleaseRunForm } from '../app/components/NewReleaseRunForm.ts';

function render(): Document {
  // Wrap in <main> + <h1> so axe sees the form's <h2> inside a landmark + heading order,
  // mirroring app/page.tsx.
  const html = renderToStaticMarkup(
    createElement(
      'main',
      { id: 'main' },
      createElement('h1', null, 'Release runs'),
      createElement(NewReleaseRunForm, null),
    ),
  );
  return new JSDOM(`<!doctype html><html lang="en"><body>${html}</body></html>`).window
    .document;
}

async function runAxe(doc: Document) {
  // color-contrast can't be evaluated in jsdom (no layout); it's covered by the e2e axe pass.
  return axe.run(doc.body, { rules: { 'color-contrast': { enabled: false } } });
}

test('the start-a-run form has zero axe violations', async () => {
  const results = await runAxe(render());
  assert.deepEqual(
    results.violations.map((v) => v.id),
    [],
    `axe violations: ${JSON.stringify(results.violations.map((v) => v.id))}`,
  );
});

test('every field is labelled and points at its describing hint', () => {
  const doc = render();
  for (const id of ['repo', 'base_ref', 'head_ref']) {
    const input = doc.getElementById(id);
    assert.ok(input, `input #${id} exists`);
    assert.ok(doc.querySelector(`label[for="${id}"]`), `label for #${id} exists`);
    assert.equal(input?.getAttribute('aria-describedby'), `${id}-hint`);
    assert.ok(doc.getElementById(`${id}-hint`), `hint #${id}-hint exists`);
    assert.equal(input?.getAttribute('required'), '');
  }
});

test('the form has a real submit button and a polite live region', () => {
  const doc = render();
  const submit = doc.querySelector('form button[type="submit"]');
  assert.equal(submit?.textContent, 'Create release run');
  const live = doc.querySelector('[role="status"][aria-live="polite"]');
  assert.ok(live, 'a polite live region is present for feedback');
});

test('the section is labelled by its heading', () => {
  const doc = render();
  const section = doc.querySelector('section[aria-labelledby="new-run-heading"]');
  assert.ok(section, 'the form section exists');
  assert.equal(doc.getElementById('new-run-heading')?.tagName, 'H2');
});

// --- T2/T5 (spec 022) — the artifact-type checkbox group ----------------------------

const ALL_TYPES = [
  'release_blog',
  'changelog_entry',
  'sales_onepager',
  'linkedin_post',
  'demo_script',
  'release_audio_digest',
  'customer_email',
  'battlecard_delta',
  'x_post',
  'hackernews_post',
];

test('the artifact-type group is a fieldset with a legend', () => {
  const doc = render();
  const fieldset = doc.querySelector('form fieldset');
  assert.ok(fieldset, 'the checkbox group is a real <fieldset>');
  assert.equal(fieldset?.querySelector('legend')?.textContent, 'Artifact types');
});

test('the full §8.1 type set renders as labelled checkboxes, checked by default', () => {
  const doc = render();
  for (const type of ALL_TYPES) {
    const id = `artifact-type-${type}`;
    const box = doc.getElementById(id);
    assert.ok(box, `checkbox #${id} exists`);
    assert.equal(box?.getAttribute('type'), 'checkbox');
    assert.equal(box?.hasAttribute('checked'), true, `${type} is checked by default`);
    assert.ok(doc.querySelector(`label[for="${id}"]`), `label for #${id} exists`);
  }
});

test('the demo_script checkbox surfaces the demo-media dependency as its hint', () => {
  const doc = render();
  const box = doc.getElementById('artifact-type-demo_script');
  const hintId = box?.getAttribute('aria-describedby');
  assert.ok(hintId, 'demo_script points at a describing hint');
  const hint = hintId ? doc.getElementById(hintId) : null;
  assert.match(hint?.textContent ?? '', /disables demo generation/i);
});
