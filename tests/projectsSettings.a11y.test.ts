// Projects (migration 0030) — AC: the Projects editor is WCAG 2.2 AA. Renders the real
// ProjectsSettings to static markup, runs axe in jsdom, and asserts labelled fields, the project
// list, the empty state, and that no secret value/ARN appears (the view carries only has_secret).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import axe from 'axe-core';
import { ProjectsSettings } from '../app/components/ProjectsSettings.ts';
import type { ProjectView } from '../app/lib/projects.ts';

const PROJECT: ProjectView = {
  id: 'proj_acme',
  tenant_id: 'default',
  name: 'Acme Launchpad',
  default_base_ref: 'main',
  default_head_ref: 'release',
  has_secret: true,
  status: 'active',
  repos: ['acme/web', 'acme/api'],
};

function render(projects: readonly ProjectView[]): Document {
  const html = renderToStaticMarkup(
    createElement('main', { id: 'main' }, createElement(ProjectsSettings, { projects })),
  );
  return new JSDOM(`<!doctype html><html lang="en"><body>${html}</body></html>`).window.document;
}

test('Projects editor has zero axe violations (populated and empty)', async () => {
  for (const projects of [[PROJECT], []]) {
    const results = await axe.run(render(projects).body, {
      rules: { 'color-contrast': { enabled: false } },
    });
    assert.deepEqual(results.violations.map((v) => v.id), []);
  }
});

test('every add-project field is labelled (label[for] ↔ control id)', () => {
  const doc = render([]);
  for (const id of [
    'project-name',
    'project-repos',
    'project-base-ref',
    'project-head-ref',
    'project-secret-id',
    'project-status',
  ]) {
    assert.ok(doc.querySelector(`#${id}`), `control #${id} exists`);
    assert.ok(doc.querySelector(`label[for="${id}"]`), `label for #${id} exists`);
  }
  assert.ok(doc.querySelector('[data-projects-settings] button'), 'a save button exists');
});

test('existing projects render as headed items with repos, secret status, and edit + delete controls', () => {
  const doc = render([PROJECT]);
  const item = doc.querySelector('[data-projects-list] li[data-project-id="proj_acme"]');
  assert.ok(item, 'project item present');
  assert.equal(item?.querySelector('h3')?.textContent, 'Acme Launchpad');
  assert.match(item?.textContent ?? '', /acme\/web/);
  assert.match(item?.querySelector('[data-secret-status="configured"]')?.textContent ?? '', /configured/i);
  const buttons = Array.from(item?.querySelectorAll('button') ?? []).map((b) => b.textContent ?? '');
  assert.ok(buttons.some((t) => /Edit/.test(t)), 'an edit control exists');
  assert.ok(buttons.some((t) => /Delete/.test(t)), 'a delete control exists');
});

test('no secret value or ARN is rendered (view carries only has_secret)', () => {
  // Even with a secret configured, the markup must never contain a token/ARN — only the status.
  const markup = render([PROJECT]).body.innerHTML;
  assert.ok(!markup.includes('arn:aws'), 'no ARN in markup');
  assert.ok(!/gh[pous]_/.test(markup), 'no GitHub token in markup');
});

test('the empty state explains what to do', () => {
  assert.match(
    render([]).querySelector('[data-projects-settings]')?.textContent ?? '',
    /No projects yet/i,
  );
});
