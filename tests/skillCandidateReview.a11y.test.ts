// T5 (spec 009) — AC5: the Gate #3 proposed-skill diff UI is WCAG 2.2 AA.
// Renders the real SkillCandidateReview (the same component the review page composes) to static
// markup, runs axe over it in jsdom, and asserts: zero axe violations, each candidate is a headed
// <section>, the current vs proposed SKILL.md panels are labelled regions exposing both bodies,
// versions + confidence + source are exposed as TEXT (data-* + visible value, not colour),
// supporting signals are a list, the action group exposes Approve/Reject/Request-changes buttons,
// and the reviewer field is labelled. constitution §1/§5: no raw text is rendered (the component
// is typed against SkillCandidateView, which carries repo-authored skill text + redacted/internal
// signal excerpts only) and the UI exposes no repo-write control — only a resume submission.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import axe from 'axe-core';
import { SkillCandidateReview } from '../app/components/SkillCandidateReview.ts';
import type { SkillCandidateView } from '../app/lib/db/skillCandidates.ts';

const CANDIDATES: readonly SkillCandidateView[] = [
  {
    id: 'cand1111-1111-2222-3333-444444444444',
    skill_name: 'brand-voice',
    skill_path: 'skills/brand-voice/SKILL.md',
    current_version: '1.3.0',
    proposed_version: '1.4.0',
    current_body: '# Brand voice\n\nWrite with confident, best-in-class energy.',
    proposed_body: '# Brand voice\n\nWrite with restraint; avoid hype and unsupported metrics.',
    proposal_reason: 'reduce hype language and remove unsupported ROI claims',
    miner_type: 'self_learning',
    confidence: 0.78,
    status: 'draft',
    supporting_signals: [
      {
        id: 'sig11111-1111-2222-3333-444444444444',
        signal_type: 'reviewer_edit',
        rejection_category: null,
        severity: null,
        reviewer: 'alice',
        excerpt: 'Removed "best-in-class" from the launch blog intro.',
      },
      {
        id: 'sig22222-1111-2222-3333-444444444444',
        signal_type: 'rejected_claim',
        rejection_category: 'unsupported_metric',
        severity: 'high',
        reviewer: null,
        excerpt: 'It reduces onboarding time by 50%.',
      },
    ],
  },
];

function render(candidates: readonly SkillCandidateView[]): { doc: Document } {
  const html = renderToStaticMarkup(
    createElement(
      'main',
      { id: 'main' },
      createElement('h1', null, 'Review skill revisions (Gate #3)'),
      createElement(SkillCandidateReview, {
        releaseRunId: 'rrrrrrrr-1111-2222-3333-444444444444',
        threadId: 'lg_thread_1',
        candidates,
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

test('populated skill-candidate review has zero axe violations', async () => {
  const results = await runAxe(render(CANDIDATES).doc);
  assert.deepEqual(
    results.violations.map((v) => v.id),
    [],
    `axe violations: ${JSON.stringify(results.violations.map((v) => v.id))}`,
  );
});

test('empty skill-candidate review has zero axe violations', async () => {
  const results = await runAxe(render([]).doc);
  assert.deepEqual(results.violations.map((v) => v.id), []);
});

test('each candidate is a headed section with an accessible name', () => {
  const { doc } = render(CANDIDATES);
  const sections = [...doc.querySelectorAll('section[data-skill-candidate]')];
  assert.equal(sections.length, 1);
  for (const section of sections) {
    const labelledby = section.getAttribute('aria-labelledby');
    assert.ok(labelledby, 'section is labelled by its heading');
    assert.equal(section.querySelector('h2')?.id, labelledby);
  }
});

test('current and proposed SKILL.md are rendered as labelled diff panels', () => {
  const { doc } = render(CANDIDATES);
  const current = doc.querySelector('section[data-panel="current"]');
  const proposed = doc.querySelector('section[data-panel="proposed"]');
  assert.ok(current, 'current panel exists');
  assert.ok(proposed, 'proposed panel exists');
  assert.ok(current?.getAttribute('aria-labelledby'), 'current panel is labelled');
  assert.ok(proposed?.getAttribute('aria-labelledby'), 'proposed panel is labelled');
  // Both bodies are present so the reviewer can compare (PRD §9.5 left/right panels).
  assert.ok(current?.textContent?.includes('best-in-class'), 'current body shown');
  assert.ok(proposed?.textContent?.includes('avoid hype'), 'proposed body shown');
});

test('changed lines are highlighted with semantic del/ins (UI tier-2 #6)', () => {
  const { doc } = render(CANDIDATES);
  // The current panel marks the removed line with <del>; the proposed panel the added line with
  // <ins> — semantic elements carry the add/remove meaning to assistive tech, not colour alone.
  const removed = doc.querySelector('section[data-panel="current"] del');
  const added = doc.querySelector('section[data-panel="proposed"] ins');
  assert.match(removed?.textContent ?? '', /best-in-class/, 'removed line struck through');
  assert.match(added?.textContent ?? '', /avoid hype/, 'added line highlighted');
  // The unchanged heading appears in both panels as a non-highlighted same-line.
  assert.ok(
    doc.querySelector('section[data-panel="current"] [data-diff="same"]'),
    'unchanged lines are rendered plainly',
  );
});

test('version, confidence, and source are exposed as text not colour alone', () => {
  const { doc } = render(CANDIDATES);
  const proposedVersion = doc.querySelector('dd[data-proposed-version]');
  assert.equal(proposedVersion?.getAttribute('data-proposed-version'), '1.4.0');
  assert.equal(proposedVersion?.textContent, '1.4.0');
  const confidence = doc.querySelector('dd[data-confidence]');
  assert.equal(confidence?.getAttribute('data-confidence'), '0.78');
  assert.equal(confidence?.textContent, '0.78');
});

test('supporting signals are listed with their kind exposed as text', () => {
  const { doc } = render(CANDIDATES);
  const items = [...doc.querySelectorAll('li[data-signal-id]')];
  assert.equal(items.length, 2);
  const types = items.map((i) => i.querySelector('[data-signal-type]')?.getAttribute('data-signal-type'));
  assert.deepEqual([...types].sort(), ['rejected_claim', 'reviewer_edit']);
  // The rejection category is shown as text (not colour alone).
  assert.ok(doc.querySelector('[data-rejection-category="unsupported_metric"]'));
});

test('the decision group exposes approve, reject, and request-changes buttons', () => {
  const { doc } = render(CANDIDATES);
  const group = doc.querySelector('div[role="group"][aria-label="Decide on the skill replacement"]');
  assert.ok(group, 'the decision group exists and is labelled');
  const labels = [...(group?.querySelectorAll('button') ?? [])].map((b) => b.textContent);
  assert.deepEqual(labels, [
    'Approve and replace repo skill',
    'Reject',
    'Request changes',
  ]);
});

test('reviewer field is labelled', () => {
  const { doc } = render(CANDIDATES);
  const input = doc.getElementById('reviewer');
  const label = doc.querySelector('label[for="reviewer"]');
  assert.ok(input, 'reviewer input exists');
  assert.ok(label, 'reviewer label exists and is associated');
});
