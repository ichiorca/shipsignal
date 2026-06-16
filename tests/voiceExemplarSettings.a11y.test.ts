// Brand & customer brain (migration 0025) — AC: the company-voice exemplar editor is WCAG 2.2 AA.
// Renders the real VoiceExemplarSettings to static markup, runs axe in jsdom, and asserts the
// labelled fields, the exemplar list (incl. the embedding-status signal), and the empty state.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import axe from 'axe-core';
import { VoiceExemplarSettings } from '../app/components/VoiceExemplarSettings.ts';
import type { IcpSegment, VoiceExemplar } from '../app/lib/brandBrain.ts';

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

const EXEMPLAR: VoiceExemplar = {
  id: 'aaaaaaaa-1111-2222-3333-444444444444',
  title: 'v1.10 launch blog',
  body_text: 'We shipped one-click rollback today. No drama, just a button.',
  channel: 'release_blog',
  source: 'blog.acme.com/v1-10',
  icp_segment_id: 'seg_platform_engineer',
  embedded: false,
};

function render(exemplars: readonly VoiceExemplar[]): Document {
  const html = renderToStaticMarkup(
    createElement(
      'main',
      { id: 'main' },
      createElement(VoiceExemplarSettings, { exemplars, segments: [SEGMENT] }),
    ),
  );
  return new JSDOM(`<!doctype html><html lang="en"><body>${html}</body></html>`).window.document;
}

test('voice editor has zero axe violations (populated and empty)', async () => {
  for (const exemplars of [[EXEMPLAR], []]) {
    const results = await axe.run(render(exemplars).body, {
      rules: { 'color-contrast': { enabled: false } },
    });
    assert.deepEqual(results.violations.map((v) => v.id), []);
  }
});

test('every add-exemplar field is labelled, incl. the channel + ICP selects', () => {
  const doc = render([]);
  for (const id of ['voice-title', 'voice-channel', 'voice-icp', 'voice-source', 'voice-body']) {
    assert.ok(doc.querySelector(`#${id}`), `control #${id} exists`);
    assert.ok(doc.querySelector(`label[for="${id}"]`), `label for #${id} exists`);
  }
  // The channel select offers "any" + the known artifact types; the ICP select offers the segment.
  assert.ok(doc.querySelector('#voice-channel option[value="release_blog"]'), 'channel options present');
  assert.ok(doc.querySelector('#voice-icp option[value="seg_platform_engineer"]'), 'ICP options present');
});

test('exemplars list with an honest embedding-status signal as text', () => {
  const doc = render([EXEMPLAR]);
  const item = doc.querySelector('[data-voice-list] li[data-voice-id]');
  assert.ok(item, 'exemplar item present');
  // Not-yet-embedded shows as text (colour is only a supplement).
  assert.match(item?.textContent ?? '', /pending embedding/);
});

test('the empty state prompts pasting real content', () => {
  assert.match(
    render([]).querySelector('[data-voice-settings]')?.textContent ?? '',
    /No voice exemplars/i,
  );
});
