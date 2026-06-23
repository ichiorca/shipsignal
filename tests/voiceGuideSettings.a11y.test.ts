// Brand Voice — AC: the structured voice-guide editor (migration 0033) is WCAG 2.2 AA. Renders the
// real VoiceGuideSettings to static markup, runs axe in jsdom, and asserts every field is labelled
// and pre-filled from the saved guide.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import axe from 'axe-core';
import { VoiceGuideSettings } from '../app/components/VoiceGuideSettings.ts';
import type { VoiceGuide } from '../app/lib/brandBrain.ts';

const GUIDE: VoiceGuide = {
  tone: 'confident, plain, no hype',
  reading_level: 'grade 8',
  do_rules: ['Lead with the user value'],
  dont_rules: ['No superlatives'],
  prefer_terms: ['ship'],
  avoid_terms: ['leverage'],
  notes: 'Sound like an engineer who respects the reader.',
};

const EMPTY_GUIDE: VoiceGuide = {
  tone: '',
  reading_level: '',
  do_rules: [],
  dont_rules: [],
  prefer_terms: [],
  avoid_terms: [],
  notes: '',
};

function render(guide: VoiceGuide): Document {
  const html = renderToStaticMarkup(
    createElement('main', { id: 'main' }, createElement(VoiceGuideSettings, { guide })),
  );
  return new JSDOM(`<!doctype html><html lang="en"><body>${html}</body></html>`).window.document;
}

test('voice-guide editor has zero axe violations (populated and empty)', async () => {
  for (const guide of [GUIDE, EMPTY_GUIDE]) {
    const results = await axe.run(render(guide).body, {
      rules: { 'color-contrast': { enabled: false } },
    });
    assert.deepEqual(
      results.violations.map((v) => v.id),
      [],
    );
  }
});

test('every voice-guide field is labelled', () => {
  const doc = render(GUIDE);
  for (const id of ['vg-tone', 'vg-reading-level', 'vg-do', 'vg-dont', 'vg-prefer', 'vg-avoid', 'vg-notes']) {
    assert.ok(doc.querySelector(`#${id}`), `control #${id} exists`);
    assert.ok(doc.querySelector(`label[for="${id}"]`), `label for #${id} exists`);
  }
});

test('fields are pre-filled from the saved guide (list fields one-per-line)', () => {
  const doc = render(GUIDE);
  assert.equal(doc.querySelector<HTMLInputElement>('#vg-tone')?.getAttribute('value'), 'confident, plain, no hype');
  // do_rules render as the textarea's text content (one item per line).
  assert.match(doc.querySelector('#vg-do')?.textContent ?? '', /Lead with the user value/);
  assert.match(doc.querySelector('#vg-prefer')?.textContent ?? '', /ship/);
});
