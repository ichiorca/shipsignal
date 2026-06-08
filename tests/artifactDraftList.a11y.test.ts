// T5 (spec 005) — AC: the draft-preview UI is WCAG 2.2 AA. Renders the real
// ArtifactDraftList (the same component the artifacts page composes) to static markup, runs
// axe over it in jsdom, and asserts: zero axe violations, each draft is a headed <article>,
// the audit-trail (model/prompt/skills) is exposed as a <dl>, status is text (not colour),
// and the body region is labelled. constitution §5: no raw text is rendered (the component
// is typed against ArtifactDraft, which carries approved-derived draft content only).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import axe from 'axe-core';
import { ArtifactDraftList } from '../app/components/ArtifactDraftList.ts';
import type { ArtifactDraft } from '../app/lib/db/artifacts.ts';

const ARTIFACTS: readonly ArtifactDraft[] = [
  {
    id: 'aaaaaaaa-1111-2222-3333-444444444444',
    release_run_id: 'rrrrrrrr-1111-2222-3333-444444444444',
    feature_id: null,
    artifact_type: 'release_blog',
    title: 'Onboarding gets a major upgrade',
    body_markdown: '# Onboarding\n\nAdmins can now build reusable checklists.',
    status: 'draft',
    model_id: 'anthropic.claude-3-5-sonnet',
    prompt_version: 'content-gen-v1',
    skill_versions: { 'brand-voice': 'abc123', 'blog-format': 'def456' },
    created_at: '2026-06-08T00:00:00.000Z',
  },
  {
    id: 'bbbbbbbb-1111-2222-3333-444444444444',
    release_run_id: 'rrrrrrrr-1111-2222-3333-444444444444',
    feature_id: null,
    artifact_type: 'changelog_entry',
    title: 'Changelog',
    body_markdown: '- Add admin-configurable onboarding checklists',
    status: 'draft',
    model_id: 'anthropic.claude-3-5-sonnet',
    prompt_version: 'content-gen-v1',
    skill_versions: { 'changelog-format': 'ghi789' },
    created_at: '2026-06-08T00:00:00.000Z',
  },
];

function render(artifacts: readonly ArtifactDraft[]): { doc: Document; html: string } {
  const html = renderToStaticMarkup(
    createElement(
      'main',
      { id: 'main' },
      createElement('h1', null, 'Draft artifacts'),
      createElement(ArtifactDraftList, { artifacts }),
    ),
  );
  const doc = new JSDOM(`<!doctype html><html lang="en"><body>${html}</body></html>`)
    .window.document;
  return { doc, html };
}

async function runAxe(doc: Document) {
  return axe.run(doc.body, { rules: { 'color-contrast': { enabled: false } } });
}

test('populated draft preview has zero axe violations', async () => {
  const results = await runAxe(render(ARTIFACTS).doc);
  assert.deepEqual(
    results.violations.map((v) => v.id),
    [],
    `axe violations: ${JSON.stringify(results.violations.map((v) => v.id))}`,
  );
});

test('empty draft preview has zero axe violations', async () => {
  const results = await runAxe(render([]).doc);
  assert.deepEqual(results.violations.map((v) => v.id), []);
});

test('each draft is a headed article with an accessible name', () => {
  const { doc } = render(ARTIFACTS);
  const articles = [...doc.querySelectorAll('article[data-artifact-id]')];
  assert.equal(articles.length, 2);
  for (const article of articles) {
    const labelledby = article.getAttribute('aria-labelledby');
    assert.ok(labelledby, 'article is labelled by its heading');
    const heading = article.querySelector('h2');
    assert.equal(heading?.id, labelledby);
  }
});

test('audit trail (model, prompt, skills) is exposed semantically', () => {
  const { doc } = render(ARTIFACTS);
  const labels = [...doc.querySelectorAll('article dl dt')].map((d) => d.textContent);
  assert.deepEqual(labels.slice(0, 5), ['Type', 'Status', 'Model', 'Prompt version', 'Skills used']);
});

test('status is rendered as text, not colour alone', () => {
  const { doc } = render(ARTIFACTS);
  const status = doc.querySelector('dd[data-status]');
  assert.equal(status?.getAttribute('data-status'), 'draft');
  assert.equal(status?.textContent, 'draft');
});

test('draft body region is labelled by its heading', () => {
  const { doc } = render(ARTIFACTS);
  const body = doc.querySelector('[data-testid="artifact-body"]');
  const labelledby = body?.getAttribute('aria-labelledby');
  assert.ok(labelledby, 'body region has an accessible name');
  assert.ok(doc.getElementById(labelledby ?? ''), 'the labelling heading exists');
});

test('empty preview shows a no-drafts message', () => {
  const { doc } = render([]);
  assert.match(doc.body.textContent ?? '', /No draft artifacts/);
});
