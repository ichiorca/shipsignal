// T5 (spec 006) — AC: the Gate #2 artifact-review UI is WCAG 2.2 AA. Renders the real
// ArtifactReview (the same component the review page composes) to static markup, runs axe over
// it in jsdom, and asserts: zero axe violations, each artifact is a headed <section>, per-claim
// support/risk are exposed as TEXT (data-* + visible value, not colour), supporting evidence is
// a list, a blocked artifact is announced via role="alert" and its Approve button is disabled,
// and the reviewer field is labelled. constitution §5: no raw text is rendered (the component is
// typed against ArtifactWithClaims, which carries redacted/approved-derived data only).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import axe from 'axe-core';
import { ArtifactReview } from '../app/components/ArtifactReview.ts';
import type { ArtifactWithClaims } from '../app/lib/db/claims.ts';

const ARTIFACTS: readonly ArtifactWithClaims[] = [
  {
    id: 'aaaaaaaa-1111-2222-3333-444444444444',
    release_run_id: 'rrrrrrrr-1111-2222-3333-444444444444',
    artifact_type: 'release_blog',
    title: 'Onboarding gets a major upgrade',
    body_markdown: '# Onboarding\n\nAdmins can now build reusable checklists.',
    status: 'draft',
    claims: [
      {
        id: 'c1111111-1111-2222-3333-444444444444',
        artifact_id: 'aaaaaaaa-1111-2222-3333-444444444444',
        claim_text: 'Admins can now create reusable onboarding checklists.',
        claim_type: 'capability',
        support_status: 'supported',
        risk_level: 'low',
        evidence: [
          {
            evidence_item_id: 'e1111111-1111-2222-3333-444444444444',
            evidence_type: 'ui_string_change',
            redacted_excerpt: 'Add button: Create onboarding checklist',
            support_score: 0.6,
          },
        ],
      },
    ],
  },
  {
    id: 'bbbbbbbb-1111-2222-3333-444444444444',
    release_run_id: 'rrrrrrrr-1111-2222-3333-444444444444',
    artifact_type: 'changelog_entry',
    title: 'Changelog',
    body_markdown: '- Reduces onboarding time by 50%',
    status: 'blocked',
    claims: [
      {
        id: 'c2222222-1111-2222-3333-444444444444',
        artifact_id: 'bbbbbbbb-1111-2222-3333-444444444444',
        claim_text: 'This reduces onboarding time by 50%.',
        claim_type: 'performance',
        support_status: 'unsupported',
        risk_level: 'high',
        evidence: [],
      },
    ],
  },
];

function render(artifacts: readonly ArtifactWithClaims[]): { doc: Document } {
  const html = renderToStaticMarkup(
    createElement(
      'main',
      { id: 'main' },
      createElement('h1', null, 'Review artifacts (Gate #2)'),
      createElement(ArtifactReview, {
        releaseRunId: 'rrrrrrrr-1111-2222-3333-444444444444',
        threadId: 'lg_thread_1',
        artifacts,
      }),
    ),
  );
  const doc = new JSDOM(`<!doctype html><html lang="en"><body>${html}</body></html>`)
    .window.document;
  return { doc };
}

async function runAxe(doc: Document) {
  return axe.run(doc.body, { rules: { 'color-contrast': { enabled: false } } });
}

test('populated artifact review has zero axe violations', async () => {
  const results = await runAxe(render(ARTIFACTS).doc);
  assert.deepEqual(
    results.violations.map((v) => v.id),
    [],
    `axe violations: ${JSON.stringify(results.violations.map((v) => v.id))}`,
  );
});

test('empty artifact review has zero axe violations', async () => {
  const results = await runAxe(render([]).doc);
  assert.deepEqual(results.violations.map((v) => v.id), []);
});

test('each artifact is a headed section with an accessible name', () => {
  const { doc } = render(ARTIFACTS);
  const sections = [...doc.querySelectorAll('section[data-artifact-id]')];
  assert.equal(sections.length, 2);
  for (const section of sections) {
    const labelledby = section.getAttribute('aria-labelledby');
    assert.ok(labelledby, 'section is labelled by its heading');
    assert.equal(section.querySelector('h2')?.id, labelledby);
  }
});

test('per-claim support and risk are exposed as text, not colour alone', () => {
  const { doc } = render(ARTIFACTS);
  const support = doc.querySelector('dd[data-support]');
  assert.equal(support?.getAttribute('data-support'), 'supported');
  assert.equal(support?.textContent, 'supported');
  const risk = doc.querySelector('dd[data-risk]');
  assert.equal(risk?.getAttribute('data-risk'), 'low');
  assert.equal(risk?.textContent, 'low');
});

test('a supported claim lists its supporting evidence', () => {
  const { doc } = render(ARTIFACTS);
  const firstSection = doc.querySelector('section[data-artifact-id] ul li[data-claim-id]');
  assert.ok(firstSection?.querySelector('ul li'), 'evidence is rendered as a list item');
});

test('a blocked artifact is announced and its Approve button is disabled', () => {
  const { doc } = render(ARTIFACTS);
  const blocked = doc.querySelector('section[data-artifact-status="blocked"]');
  assert.ok(blocked, 'the blocked artifact section exists');
  assert.ok(blocked?.querySelector('[role="alert"]'), 'a blocked artifact has an alert');
  const approve = [...(blocked?.querySelectorAll('button') ?? [])].find(
    (b) => b.textContent === 'Approve',
  );
  assert.ok(approve?.hasAttribute('disabled'), 'Approve is disabled on a blocked artifact');
});

test('reviewer field is labelled', () => {
  const { doc } = render(ARTIFACTS);
  const input = doc.getElementById('reviewer');
  const label = doc.querySelector('label[for="reviewer"]');
  assert.ok(input, 'reviewer input exists');
  assert.ok(label, 'reviewer label exists and is associated');
});
