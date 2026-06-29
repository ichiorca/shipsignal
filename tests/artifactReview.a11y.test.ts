// T5 (spec 006) / T4 (spec 007) — AC: the Gate #2 multi-artifact-review UI is WCAG 2.2 AA.
// Renders the real ArtifactReview (the same component the review page composes) to static markup,
// runs axe over it in jsdom, and asserts: zero axe violations, artifacts are grouped into a
// labelled <section> per artifact type (T4), each artifact is a headed <section>, per-claim
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
  // A new spec-007 artifact type — proves the four expanded types render + group correctly.
  {
    id: 'cccccccc-1111-2222-3333-444444444444',
    release_run_id: 'rrrrrrrr-1111-2222-3333-444444444444',
    artifact_type: 'demo_script',
    title: 'Onboarding demo walkthrough',
    body_markdown: '# Demo\n\n1. Open admin → narration: "Create a checklist."',
    status: 'draft',
    claims: [
      {
        id: 'c3333333-1111-2222-3333-444444444444',
        artifact_id: 'cccccccc-1111-2222-3333-444444444444',
        claim_text: 'Admins can open the onboarding checklist builder.',
        claim_type: 'capability',
        support_status: 'supported',
        risk_level: 'low',
        evidence: [
          {
            evidence_item_id: 'e3333333-1111-2222-3333-444444444444',
            evidence_type: 'ui_string_change',
            redacted_excerpt: 'Add menu: Onboarding checklist builder',
            support_score: 0.5,
          },
        ],
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
  assert.equal(sections.length, 3);
  for (const section of sections) {
    const labelledby = section.getAttribute('aria-labelledby');
    assert.ok(labelledby, 'section is labelled by its heading');
    // The artifact heading sits under its type-group <h2>, so it is an <h3>.
    assert.equal(section.querySelector('h3')?.id, labelledby);
  }
});

test('artifacts are grouped into a labelled section per artifact type', () => {
  const { doc } = render(ARTIFACTS);
  const groups = [...doc.querySelectorAll('section[data-artifact-type-group]')];
  // Three distinct types in the fixture → three groups, each named by its <h2>.
  assert.equal(groups.length, 3);
  const groupedTypes = groups.map((g) => g.getAttribute('data-artifact-type-group'));
  assert.deepEqual(
    [...groupedTypes].sort(),
    ['changelog_entry', 'demo_script', 'release_blog'],
  );
  for (const group of groups) {
    const labelledby = group.getAttribute('aria-labelledby');
    assert.ok(labelledby, 'type group is labelled by its heading');
    assert.equal(group.querySelector('h2')?.id, labelledby);
    // Each group contains at least one artifact subsection.
    assert.ok(group.querySelector('section[data-artifact-id]'), 'group holds artifacts');
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

test('R8 — the batch toolbar shows shortcut help and a live progress meter', () => {
  const { doc } = render(ARTIFACTS);
  const shortcuts = doc.querySelector('[data-review-shortcuts]');
  assert.ok(shortcuts, 'shortcut help is present');
  assert.equal(doc.querySelectorAll('[data-review-shortcuts] kbd').length, 3, 'A/R/E keys shown');
  const progress = doc.querySelector('[data-review-progress]');
  assert.ok(progress, 'progress meter is present');
  assert.equal(progress?.getAttribute('aria-live'), 'polite', 'progress is announced politely');
  assert.match(progress?.textContent ?? '', /0 of \d+ reviewed/, 'starts at none reviewed');
});

test('R8 — each artifact section carries its id so keyboard triage can target it', () => {
  const { doc } = render(ARTIFACTS);
  // The keydown handler resolves the focused artifact via closest('[data-artifact-id]').
  assert.equal(doc.querySelectorAll('[data-artifact-id]').length, ARTIFACTS.length);
});
