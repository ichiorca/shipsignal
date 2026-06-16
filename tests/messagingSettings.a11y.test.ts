// Brand & customer brain (migration 0025) — AC: the messaging-claim editor is WCAG 2.2 AA.
// Renders the real MessagingSettings to static markup, runs axe in jsdom, and asserts the labelled
// fields, the claim list, and the empty state.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import axe from 'axe-core';
import { MessagingSettings } from '../app/components/MessagingSettings.ts';
import type { IcpSegment, MessagingClaim } from '../app/lib/brandBrain.ts';

const SEGMENT: IcpSegment = {
  id: 'seg_platform_engineer',
  name: 'Platform engineer',
  description: '',
  buyer_roles: [],
  pain_points: [],
  objections: [],
  approved_angles: [],
  status: 'active',
};

const CLAIM: MessagingClaim = {
  id: 'bbbbbbbb-1111-2222-3333-444444444444',
  claim_text: 'On-brand release content straight from your diffs, with claim-level provenance.',
  claim_type: 'positioning',
  evidence_url: 'internal://product/provenance',
  applies_to_icp: ['seg_platform_engineer'],
  status: 'approved',
};

function render(claims: readonly MessagingClaim[]): Document {
  const html = renderToStaticMarkup(
    createElement(
      'main',
      { id: 'main' },
      createElement(MessagingSettings, { claims, segments: [SEGMENT] }),
    ),
  );
  return new JSDOM(`<!doctype html><html lang="en"><body>${html}</body></html>`).window.document;
}

test('messaging editor has zero axe violations (populated and empty)', async () => {
  for (const claims of [[CLAIM], []]) {
    const results = await axe.run(render(claims).body, {
      rules: { 'color-contrast': { enabled: false } },
    });
    assert.deepEqual(results.violations.map((v) => v.id), []);
  }
});

test('every add-claim field is labelled', () => {
  const doc = render([]);
  for (const id of ['claim-text', 'claim-type', 'claim-evidence', 'claim-icp', 'claim-status']) {
    assert.ok(doc.querySelector(`#${id}`), `control #${id} exists`);
    assert.ok(doc.querySelector(`label[for="${id}"]`), `label for #${id} exists`);
  }
});

test('claims list as headed items with their ICP scope and a delete control', () => {
  const doc = render([CLAIM]);
  const item = doc.querySelector('[data-messaging-list] li[data-claim-id]');
  assert.ok(item, 'claim item present');
  assert.match(item?.querySelector('h3')?.textContent ?? '', /straight from your diffs/);
  assert.match(item?.textContent ?? '', /seg_platform_engineer/); // ICP scope shown as text
  assert.match(item?.querySelector('button')?.textContent ?? '', /Delete/);
});

test('the empty state explains the purpose', () => {
  assert.match(
    render([]).querySelector('[data-messaging-settings]')?.textContent ?? '',
    /No messaging claims/i,
  );
});
