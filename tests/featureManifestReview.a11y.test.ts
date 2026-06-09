// T5 (spec 004) — AC: the Gate #1 review UI is WCAG 2.2 AA and exposes the approve and
// reject flows. Renders the real FeatureManifestReview (the same component the review
// page composes) to static markup, runs axe over it in jsdom, and asserts: zero axe
// violations, a labelled reviewer field, a live-region status, and per-feature
// Approve/Reject/Save-edits controls with accessible names. constitution §5: no raw text
// is rendered (the component is typed against FeatureCluster, which carries redacted
// content only).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import axe from 'axe-core';
import { FeatureManifestReview } from '../app/components/FeatureManifestReview.ts';
import type { FeatureCluster } from '../app/lib/db/features.ts';

const FEATURES: readonly FeatureCluster[] = [
  {
    id: 'ffffffff-1111-2222-3333-444444444444',
    release_run_id: 'rrrrrrrr-1111-2222-3333-444444444444',
    title: 'Admin-configurable onboarding checklist',
    summary_internal: 'Admins create and assign onboarding checklists.',
    user_value: 'Repeatable onboarding rollout.',
    audiences: ['admin', 'customer_success'],
    change_type: 'new_feature',
    surface_area: ['web_app'],
    marketability_score: 0.78,
    demoability_score: 0.91,
    confidence: 0.84,
    launch_risk: 'low',
    status: 'pending_review',
    reviewer_notes: null,
    evidence: [
      {
        evidence_item_id: 'aaaaaaaa-1111-2222-3333-444444444444',
        evidence_type: 'ui_string_change',
        redacted_excerpt: 'Add button: Create onboarding checklist',
        relevance_score: 0.8,
      },
    ],
  },
];

function render(features: readonly FeatureCluster[]): { doc: Document; html: string } {
  const html = renderToStaticMarkup(
    createElement(
      'main',
      { id: 'main' },
      createElement('h1', null, 'Approve feature manifest'),
      createElement(FeatureManifestReview, {
        releaseRunId: 'rrrrrrrr-1111-2222-3333-444444444444',
        threadId: 'lg_thread_1',
        features,
      }),
    ),
  );
  const doc = new JSDOM(`<!doctype html><html lang="en"><body>${html}</body></html>`)
    .window.document;
  return { doc, html };
}

async function runAxe(doc: Document) {
  return axe.run(doc.body, { rules: { 'color-contrast': { enabled: false } } });
}

test('populated review UI has zero axe violations', async () => {
  const results = await runAxe(render(FEATURES).doc);
  assert.deepEqual(
    results.violations.map((v) => v.id),
    [],
    `axe violations: ${JSON.stringify(results.violations.map((v) => v.id))}`,
  );
});

test('empty review UI has zero axe violations', async () => {
  const results = await runAxe(render([]).doc);
  assert.deepEqual(results.violations.map((v) => v.id), []);
});

test('reviewer field is labelled (keyboard/AT operable)', () => {
  const { doc } = render(FEATURES);
  const label = doc.querySelector('label[for="reviewer"]');
  const input = doc.querySelector('input#reviewer');
  assert.equal(label?.textContent, 'Reviewer name (required)');
  assert.ok(input, 'reviewer input is present');
  assert.equal(input?.getAttribute('required'), '', 'reviewer field is marked required');
});

test('exposes the approve and reject flows per feature with accessible names', () => {
  const { doc } = render(FEATURES);
  const group = doc.querySelector('section[data-feature-id] div[role="group"]');
  const labels = [...(group?.querySelectorAll('button') ?? [])].map((b) => b.textContent);
  assert.deepEqual(labels, ['Approve', 'Reject', 'Save edits']);
  assert.ok(
    group?.getAttribute('aria-label')?.startsWith('Decision for'),
    'decision group has an accessible name',
  );
});

test('decision status uses a polite live region', () => {
  const { doc } = render(FEATURES);
  const status = doc.querySelector('[role="status"]');
  assert.equal(status?.getAttribute('aria-live'), 'polite');
});

test('feature heading + scores are exposed semantically', () => {
  const { doc } = render(FEATURES);
  const section = doc.querySelector('section[data-feature-id]');
  assert.ok(section?.getAttribute('aria-labelledby'), 'section is labelled by its heading');
  const heading = section?.querySelector('h2');
  assert.equal(heading?.textContent, 'Admin-configurable onboarding checklist');
  const scoreLabels = [...(section?.querySelectorAll('dl dt') ?? [])].map((d) => d.textContent);
  assert.deepEqual(scoreLabels, ['Marketability', 'Demoability', 'Confidence']);
});
