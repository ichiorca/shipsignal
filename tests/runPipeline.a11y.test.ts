// UI tier-1 #2 — AC: the run lifecycle stepper is WCAG 2.2 AA, marks the active stage with
// aria-current, links only reachable stages, and carries state as text. Renders the real
// RunPipeline (fed by the real buildPipeline) to static markup and runs axe in jsdom.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import axe from 'axe-core';
import { RunPipeline } from '../app/components/RunPipeline.ts';
import { buildPipeline } from '../app/lib/runProgress.ts';
import type { ReleaseRun } from '../app/lib/db/releaseRuns.ts';

function run(status: ReleaseRun['status']): ReleaseRun {
  return {
    id: 'aaaaaaaa-1111-2222-3333-444444444444',
    repo: 'org/product',
    base_ref: 'v1.0',
    head_ref: 'v1.1',
    trigger_type: 'manual',
    status,
    artifact_types: ['release_blog'],
    langgraph_thread_id: null,
    started_at: '2026-06-07T10:00:00.000Z',
    completed_at: null,
  };
}

function render(status: ReleaseRun['status']): Document {
  const html = renderToStaticMarkup(
    createElement('main', { id: 'main' }, createElement(RunPipeline, { stages: buildPipeline(run(status)) })),
  );
  return new JSDOM(`<!doctype html><html lang="en"><body>${html}</body></html>`).window.document;
}

test('pipeline stepper has zero axe violations', async () => {
  const results = await axe.run(render('artifacts_pending_review').body, {
    rules: { 'color-contrast': { enabled: false } },
  });
  assert.deepEqual(results.violations.map((v) => v.id), []);
});

test('it is a semantic ordered list with one item per lifecycle stage', () => {
  const doc = render('artifacts_pending_review');
  assert.ok(doc.querySelector('nav[aria-label="Run pipeline"] ol'), 'ordered list present');
  assert.equal(doc.querySelectorAll('nav[aria-label="Run pipeline"] ol > li').length, 6);
});

test('the gate the run is halted at is marked current and awaiting; earlier stages are done', () => {
  const doc = render('artifacts_pending_review');
  const gate2 = doc.querySelector('li[data-stage="gate2"]');
  assert.equal(gate2?.getAttribute('aria-current'), 'step', 'active stage is aria-current="step"');
  assert.equal(gate2?.getAttribute('data-state'), 'awaiting');
  assert.equal(doc.querySelector('li[data-stage="evidence"]')?.getAttribute('data-state'), 'done');
  // The state is conveyed as text, not colour alone.
  assert.match(gate2?.textContent ?? '', /Awaiting you/);
});

test('reachable stages link out; not-yet-reached stages are inert (no dead links)', () => {
  const doc = render('artifacts_pending_review');
  // gate2 (awaiting) links to its review screen…
  assert.ok(
    doc.querySelector('li[data-stage="gate2"] a[href$="/artifacts/review"]'),
    'awaiting gate links to its screen',
  );
  // …while an upcoming stage (media) renders no link.
  assert.equal(doc.querySelector('li[data-stage="media"] a'), null, 'upcoming stage has no link');
  assert.equal(doc.querySelector('li[data-stage="media"]')?.getAttribute('data-state'), 'upcoming');
});
