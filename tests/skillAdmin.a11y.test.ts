// T5 (spec 015) — AC: the Skill-admin screen is WCAG 2.2 AA. Renders the real SkillAdmin
// (the same component the /skills page composes) to static markup, runs axe over it in
// jsdom, and asserts: zero axe violations (populated + empty), both tables are captioned
// with column headers, the candidate status is exposed as TEXT (data-attr + visible
// value, not colour), and the snapshot count is shown.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import axe from 'axe-core';
import { SkillAdmin } from '../app/components/SkillAdmin.ts';
import type { SkillSummary } from '../app/lib/db/skills.ts';
import type { SkillCandidateSummary } from '../app/lib/db/skillCandidates.ts';

const SKILLS: readonly SkillSummary[] = [
  {
    skill_name: 'brand-voice',
    skill_path: 'skills/brand-voice/SKILL.md',
    repo: 'org/product',
    active_version: '1.3.0',
    active_commit_sha: 'abc1234def5678',
    active_content_hash: 'deadbeefcafe1234',
    snapshot_count: 3,
  },
];

const CANDIDATES: readonly SkillCandidateSummary[] = [
  {
    id: 'cand1111-1111-2222-3333-444444444444',
    skill_name: 'brand-voice',
    skill_path: 'skills/brand-voice/SKILL.md',
    proposed_version: '1.4.0',
    miner_type: 'self_learning',
    confidence: 0.78,
    status: 'pending_review',
    created_at: '2026-06-07T10:00:00.000Z',
  },
];

function render(
  skills: readonly SkillSummary[],
  candidates: readonly SkillCandidateSummary[],
): Document {
  const html = renderToStaticMarkup(
    createElement(
      'main',
      { id: 'main' },
      createElement('h1', null, 'Skill admin'),
      createElement(SkillAdmin, { skills, candidates }),
    ),
  );
  return new JSDOM(`<!doctype html><html lang="en"><body>${html}</body></html>`).window
    .document;
}

async function runAxe(doc: Document) {
  return axe.run(doc.body, { rules: { 'color-contrast': { enabled: false } } });
}

test('populated skill-admin screen has zero axe violations', async () => {
  const results = await runAxe(render(SKILLS, CANDIDATES));
  assert.deepEqual(
    results.violations.map((v) => v.id),
    [],
    `axe violations: ${JSON.stringify(results.violations.map((v) => v.id))}`,
  );
});

test('empty skill-admin screen has zero axe violations', async () => {
  const results = await runAxe(render([], []));
  assert.deepEqual(results.violations.map((v) => v.id), []);
});

test('both tables are captioned with column headers', () => {
  const doc = render(SKILLS, CANDIDATES);
  const captions = [...doc.querySelectorAll('table > caption')].map((c) => c.textContent);
  assert.deepEqual(captions, ['Active repo skills', 'Skill-revision candidates']);
  for (const table of doc.querySelectorAll('table')) {
    const headers = [...table.querySelectorAll('thead th[scope="col"]')];
    assert.ok(headers.length > 0, 'each table has column headers');
  }
});

test('the active skill row shows version and snapshot count', () => {
  const doc = render(SKILLS, CANDIDATES);
  const row = doc.querySelector('tr[data-skill-name="brand-voice"]');
  assert.ok(row, 'the skill row exists');
  assert.ok(row?.textContent?.includes('1.3.0'), 'active version shown');
  const count = doc.querySelector('td[data-snapshot-count]');
  assert.equal(count?.getAttribute('data-snapshot-count'), '3');
  assert.equal(count?.textContent, '3');
});

test('candidate lifecycle status is exposed as text not colour alone', () => {
  const doc = render(SKILLS, CANDIDATES);
  const statusCell = doc.querySelector('td[data-status]');
  assert.equal(statusCell?.getAttribute('data-status'), 'pending_review');
  assert.equal(statusCell?.textContent, 'pending_review');
});
