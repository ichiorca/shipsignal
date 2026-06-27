// AC: the Connections manager is WCAG 2.2 AA in both states — a Connect link when disconnected, a
// Disconnect button + "Connected as …" when connected. Renders the real component to static markup
// and runs axe in jsdom.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import axe from 'axe-core';
import { ConnectionsManager } from '../app/components/ConnectionsManager.ts';

function render(connected: boolean, accountLabel: string | null): Document {
  const html = renderToStaticMarkup(
    createElement(
      'main',
      { id: 'main' },
      createElement(ConnectionsManager, { connected, accountLabel }),
    ),
  );
  return new JSDOM(`<!doctype html><html lang="en"><body>${html}</body></html>`).window.document;
}

test('connections manager has zero axe violations (connected and disconnected)', async () => {
  for (const [connected, label] of [
    [false, null],
    [true, 'ShipSignal Demos'],
  ] as const) {
    const results = await axe.run(render(connected, label).body, {
      rules: { 'color-contrast': { enabled: false } },
    });
    assert.deepEqual(
      results.violations.map((v) => v.id),
      [],
    );
  }
});

test('disconnected → a Connect link to the OAuth start route', () => {
  const doc = render(false, null);
  const link = doc.querySelector('a[data-connect="google_youtube"]');
  assert.ok(link, 'connect link exists');
  assert.equal(link?.getAttribute('href'), '/api/connections/google');
  assert.match(doc.querySelector('[data-connection-status]')?.getAttribute('data-connection-status') ?? '', /disconnected/);
});

test('connected → a disconnect button and the account label', () => {
  const doc = render(true, 'ShipSignal Demos');
  assert.ok(doc.querySelector('[data-connection="google_youtube"] button'), 'disconnect button exists');
  assert.match(doc.body.textContent ?? '', /Connected as ShipSignal Demos/);
});
