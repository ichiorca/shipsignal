// Brand & customer brain (migration 0025) — AC: the ICP segment editor is WCAG 2.2 AA. Renders
// the real IcpSettings to static markup, runs axe in jsdom, and asserts the editor's labelled
// fields, segment list, and empty state.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import axe from 'axe-core';
import { IcpSettings } from '../app/components/IcpSettings.ts';
import type { IcpSegment } from '../app/lib/brandBrain.ts';

const SEGMENT: IcpSegment = {
  id: 'seg_platform_engineer',
  name: 'Platform engineer',
  description: 'Eng lead adopting agentic release tooling.',
  buyer_roles: ['Staff Engineer'],
  pain_points: ['Manual release comms eat a day'],
  objections: ['Is the output actually on-brand?'],
  approved_angles: ['Ship the release, not the busywork'],
  status: 'active',
};

function render(segments: readonly IcpSegment[]): Document {
  const html = renderToStaticMarkup(
    createElement('main', { id: 'main' }, createElement(IcpSettings, { segments })),
  );
  return new JSDOM(`<!doctype html><html lang="en"><body>${html}</body></html>`).window.document;
}

test('ICP editor has zero axe violations (populated and empty)', async () => {
  for (const segments of [[SEGMENT], []]) {
    const results = await axe.run(render(segments).body, {
      rules: { 'color-contrast': { enabled: false } },
    });
    assert.deepEqual(results.violations.map((v) => v.id), []);
  }
});

test('every add-segment field is labelled (label[for] ↔ control id)', () => {
  const doc = render([]);
  for (const id of [
    'icp-name',
    'icp-description',
    'icp-buyer-roles',
    'icp-pains',
    'icp-objections',
    'icp-angles',
    'icp-status',
  ]) {
    assert.ok(doc.querySelector(`#${id}`), `control #${id} exists`);
    assert.ok(doc.querySelector(`label[for="${id}"]`), `label for #${id} exists`);
  }
  assert.ok(doc.querySelector('[data-icp-settings] button'), 'a save button exists');
});

test('existing segments render as headed items with a delete control', () => {
  const doc = render([SEGMENT]);
  const item = doc.querySelector('[data-icp-list] li[data-icp-id="seg_platform_engineer"]');
  assert.ok(item, 'segment item present');
  assert.equal(item?.querySelector('h3')?.textContent, 'Platform engineer');
  assert.match(item?.querySelector('button')?.textContent ?? '', /Delete/);
});

test('the empty state explains what to do', () => {
  assert.match(render([]).querySelector('[data-icp-settings]')?.textContent ?? '', /No ICP segments/i);
});
