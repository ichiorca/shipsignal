// AC: the confirmation gate is WCAG 2.2 AA in its default (closed) state. The dialog's
// modal focus trap / Escape handling come from the native <dialog> showModal() path,
// which needs a live browser (covered by the e2e axe pass); here we assert the closed
// markup a screen-reader user first meets: a single real <button> trigger, no orphaned
// dialog content, and zero axe violations.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import axe from 'axe-core';
import { ConfirmButton } from '../app/components/ConfirmButton.ts';

function render(): Document {
  const html = renderToStaticMarkup(
    createElement(
      'main',
      { id: 'main' },
      createElement('h1', null, 'Gate'),
      createElement(ConfirmButton, {
        label: 'Approve & resume',
        title: 'Approve and resume the run?',
        body: 'This resumes the worker past the gate and cannot be undone.',
        confirmLabel: 'Yes, approve & resume',
        onConfirm: () => undefined,
      }),
    ),
  );
  return new JSDOM(`<!doctype html><html lang="en"><body>${html}</body></html>`).window
    .document;
}

async function runAxe(doc: Document) {
  return axe.run(doc.body, { rules: { 'color-contrast': { enabled: false } } });
}

test('the closed confirm gate has zero axe violations', async () => {
  const results = await runAxe(render());
  assert.deepEqual(
    results.violations.map((v) => v.id),
    [],
    `axe violations: ${JSON.stringify(results.violations.map((v) => v.id))}`,
  );
});

test('the closed state renders only the trigger button (no orphaned dialog)', () => {
  const doc = render();
  const buttons = [...doc.querySelectorAll('button')];
  assert.equal(buttons.length, 1);
  assert.equal(buttons[0]?.textContent, 'Approve & resume');
  assert.equal(buttons[0]?.getAttribute('type'), 'button');
  assert.equal(doc.querySelector('dialog'), null, 'dialog is mounted only when open');
});
