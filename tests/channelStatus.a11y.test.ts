// Path B / Phase 3 — AC: the Distribute channel-status surface passes axe/keyboard checks
// (WCAG 2.2 AA) and conveys connection state as text (a dry-run channel must say so, not rely on
// colour). Renders the real ChannelStatus component to static markup and runs axe-core in jsdom.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import axe from 'axe-core';
import { ChannelStatus, type ChannelStatusProps } from '../app/components/ChannelStatus.ts';

function render(props: ChannelStatusProps): Document {
  const html = renderToStaticMarkup(
    createElement('main', { id: 'main' }, createElement('h1', null, 'Distribute'), createElement(ChannelStatus, props)),
  );
  return new JSDOM(`<!doctype html><html lang="en"><body>${html}</body></html>`).window.document;
}

const CONNECTED: ChannelStatusProps = {
  linkedinConfigured: true,
  xConfigured: true,
  dryRun: false,
  mode: 'manual',
};
const DRY: ChannelStatusProps = {
  linkedinConfigured: false,
  xConfigured: false,
  dryRun: true,
  mode: 'manual',
};

test('connected channel status has zero axe violations', async () => {
  const results = await axe.run(render(CONNECTED).body, { rules: { 'color-contrast': { enabled: false } } });
  assert.deepEqual(
    results.violations.map((v) => v.id),
    [],
    `axe violations: ${JSON.stringify(results.violations.map((v) => v.id))}`,
  );
});

test('dry-run channel status has zero axe violations and explains itself in text', async () => {
  const doc = render(DRY);
  const results = await axe.run(doc.body, { rules: { 'color-contrast': { enabled: false } } });
  assert.deepEqual(results.violations.map((v) => v.id), []);
  assert.match(doc.querySelector('[data-dry-run-note]')?.textContent ?? '', /nothing is sent/);
});

test('each channel state is rendered as text in a dl', () => {
  const doc = render(DRY);
  const linkedin = doc.querySelector('[data-channel="linkedin"] dd')?.textContent ?? '';
  assert.match(linkedin, /Dry run/);
  const hn = doc.querySelector('[data-channel="hackernews"] dd')?.textContent ?? '';
  assert.match(hn, /Assisted/);
});

test('connected channels read as Connected; mode is shown', () => {
  const doc = render(CONNECTED);
  assert.equal(doc.querySelector('[data-channel="x"] dd')?.getAttribute('data-channel-state'), 'connected');
  assert.equal(doc.querySelector('[data-publish-mode]')?.textContent, 'Manual');
});
