// Frontend audit — AC: the webhook dashboard passes axe/keyboard checks (WCAG 2.2 AA) and
// conveys delivery state as text, not colour alone. Renders the real WebhookDeliveries component
// (the same one the /webhooks page composes) to static markup, runs axe-core in jsdom, and
// asserts the semantic structure (captions, column headers, status text) the UI depends on.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import axe from 'axe-core';
import { WebhookDeliveries } from '../app/components/WebhookDeliveries.ts';
import {
  summarizeOutboundDeliveries,
  type OutboundDeliveryRow,
  type InboundDeliveryRow,
} from '../app/lib/webhookDeliveryView.ts';

const OUTBOUND: readonly OutboundDeliveryRow[] = [
  {
    delivery_id: 'del-1111',
    release_run_id: 'aaaaaaaa-1111-2222-3333-444444444444',
    artifact_id: 'art-aaaa-bbbb-cccc',
    event_type: 'artifact.approved',
    target_url: 'https://hooks.example.com/shipsignal',
    attempt_count: 1,
    last_status: 200,
    last_error: null,
    delivered_at: '2026-06-10T10:05:00.000Z',
    created_at: '2026-06-10T10:00:00.000Z',
    updated_at: '2026-06-10T10:05:00.000Z',
  },
  {
    delivery_id: 'del-2222',
    release_run_id: 'bbbbbbbb-1111-2222-3333-444444444444',
    artifact_id: 'art-dddd-eeee-ffff',
    event_type: 'artifact.approved',
    target_url: 'https://hooks.example.com/shipsignal',
    attempt_count: 3,
    last_status: 500,
    last_error: 'upstream 500',
    delivered_at: null,
    created_at: '2026-06-10T11:00:00.000Z',
    updated_at: '2026-06-10T11:09:00.000Z',
  },
];

const INBOUND: readonly InboundDeliveryRow[] = [
  { delivery_guid: 'guid-abc-123', source: 'github', received_at: '2026-06-10T09:00:00.000Z' },
];

function render(
  outbound: readonly OutboundDeliveryRow[],
  inbound: readonly InboundDeliveryRow[],
): Document {
  const html = renderToStaticMarkup(
    createElement(
      'main',
      { id: 'main' },
      createElement(WebhookDeliveries, {
        outbound,
        inbound,
        totals: summarizeOutboundDeliveries(outbound),
      }),
    ),
  );
  return new JSDOM(`<!doctype html><html lang="en"><body>${html}</body></html>`).window.document;
}

async function runAxe(doc: Document) {
  return axe.run(doc.body, { rules: { 'color-contrast': { enabled: false } } });
}

test('populated webhook dashboard has zero axe violations', async () => {
  const results = await runAxe(render(OUTBOUND, INBOUND));
  assert.deepEqual(
    results.violations.map((v) => v.id),
    [],
    `axe violations: ${JSON.stringify(results.violations.map((v) => v.id))}`,
  );
});

test('empty webhook dashboard has zero axe violations', async () => {
  const results = await runAxe(render([], []));
  assert.deepEqual(results.violations.map((v) => v.id), []);
});

test('both tables are semantically captioned', () => {
  const doc = render(OUTBOUND, INBOUND);
  const captions = [...doc.querySelectorAll('table > caption')].map((c) => c.textContent);
  assert.deepEqual(captions, [
    'Outbound deliveries (artifact.approved)',
    'Inbound deliveries (deduped)',
  ]);
});

test('delivery state is rendered as humanized text, not colour alone', () => {
  const doc = render(OUTBOUND, INBOUND);
  const states = [...doc.querySelectorAll('td[data-status] span')].map((s) => s.textContent);
  // First row delivered (2xx + delivered_at), second failed (5xx, no delivery) — note the failed
  // cell also contains the inline error span, so assert the leading state label.
  assert.equal(states[0], 'Delivered');
  assert.ok(states.some((s) => s?.startsWith('Failed')));
});

test('summary strip counts delivered / failed / pending', () => {
  const doc = render(OUTBOUND, INBOUND);
  const stat = (key: string) =>
    doc.querySelector(`[data-delivery-stat="${key}"] [data-stat-value]`)?.textContent;
  assert.equal(stat('total'), '2');
  assert.equal(stat('delivered'), '1');
  assert.equal(stat('failed'), '1');
  assert.equal(stat('pending'), '0');
});
