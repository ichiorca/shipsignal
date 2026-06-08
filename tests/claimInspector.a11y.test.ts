// T5 (spec 015) — AC: the standalone Claim-inspector screen is WCAG 2.2 AA. Renders the
// real ClaimInspector (the same component the /artifacts/[id] page composes) to static
// markup, runs axe over it in jsdom, and asserts: zero axe violations (populated + empty),
// each claim is a headed <section>, support status + risk level are exposed as TEXT (not
// colour alone), and the linked evidence is a semantic list.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import axe from 'axe-core';
import { ClaimInspector } from '../app/components/ClaimInspector.ts';
import type { ArtifactWithClaims } from '../app/lib/db/claims.ts';

const ARTIFACT: ArtifactWithClaims = {
  id: 'art11111-1111-2222-3333-444444444444',
  release_run_id: 'run11111-1111-2222-3333-444444444444',
  artifact_type: 'release_blog',
  title: 'Onboarding checklists',
  body_markdown: '# Onboarding checklists\n\nAdmins can now create reusable checklists.',
  status: 'draft',
  claims: [
    {
      id: 'claim111-1111-2222-3333-444444444444',
      artifact_id: 'art11111-1111-2222-3333-444444444444',
      claim_text: 'Admins can now create reusable onboarding checklists.',
      claim_type: 'capability',
      support_status: 'supported',
      risk_level: 'low',
      evidence: [
        {
          evidence_item_id: 'ev111111-1111-2222-3333-444444444444',
          evidence_type: 'ui_string_change',
          redacted_excerpt: 'Add button: Create onboarding checklist',
          support_score: 0.86,
        },
      ],
    },
    {
      id: 'claim222-1111-2222-3333-444444444444',
      artifact_id: 'art11111-1111-2222-3333-444444444444',
      claim_text: 'This reduces onboarding time by 50%.',
      claim_type: 'performance',
      support_status: 'unsupported',
      risk_level: 'high',
      evidence: [],
    },
  ],
};

const EMPTY: ArtifactWithClaims = { ...ARTIFACT, claims: [] };

function render(artifact: ArtifactWithClaims): Document {
  const html = renderToStaticMarkup(
    createElement(
      'main',
      { id: 'main' },
      createElement('h1', null, 'Claim inspector'),
      createElement(ClaimInspector, { artifact }),
    ),
  );
  return new JSDOM(`<!doctype html><html lang="en"><body>${html}</body></html>`).window
    .document;
}

async function runAxe(doc: Document) {
  return axe.run(doc.body, { rules: { 'color-contrast': { enabled: false } } });
}

test('populated claim inspector has zero axe violations', async () => {
  const results = await runAxe(render(ARTIFACT));
  assert.deepEqual(
    results.violations.map((v) => v.id),
    [],
    `axe violations: ${JSON.stringify(results.violations.map((v) => v.id))}`,
  );
});

test('empty claim inspector has zero axe violations', async () => {
  const results = await runAxe(render(EMPTY));
  assert.deepEqual(results.violations.map((v) => v.id), []);
});

test('each claim is a headed section with an accessible name', () => {
  const doc = render(ARTIFACT);
  const sections = [...doc.querySelectorAll('section[data-claim-id]')];
  assert.equal(sections.length, 2);
  for (const section of sections) {
    const labelledby = section.getAttribute('aria-labelledby');
    assert.ok(labelledby, 'claim section is labelled by its heading');
    assert.equal(section.querySelector('h2')?.id, labelledby);
  }
});

test('support status and risk level are exposed as text not colour alone', () => {
  const doc = render(ARTIFACT);
  const supported = doc.querySelector('section[data-claim-id="claim111-1111-2222-3333-444444444444"]');
  assert.equal(supported?.getAttribute('data-support-status'), 'supported');
  assert.equal(supported?.getAttribute('data-risk-level'), 'low');
  // The values are also present as readable text inside the section.
  assert.ok(supported?.textContent?.includes('supported'), 'support status shown as text');
  assert.ok(supported?.textContent?.includes('low'), 'risk level shown as text');
});

test('an unsupported claim explicitly states it has no linked evidence', () => {
  const doc = render(ARTIFACT);
  const unsupported = doc.querySelector('section[data-claim-id="claim222-1111-2222-3333-444444444444"]');
  assert.ok(unsupported?.querySelector('p[data-evidence="none"]'), 'no-evidence note shown');
});

test('linked evidence renders as a list with the redacted excerpt', () => {
  const doc = render(ARTIFACT);
  const items = [...doc.querySelectorAll('li[data-evidence-id]')];
  assert.equal(items.length, 1);
  assert.ok(items[0]?.textContent?.includes('Create onboarding checklist'), 'redacted excerpt shown');
});
