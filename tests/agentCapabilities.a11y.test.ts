// Agent→capability mapping (migration 0035) — AC: the agent-capability editor is WCAG 2.2 AA and
// renders the persisted mapping with add/remove controls. Renders the real AgentCapabilitiesEditor
// to static markup, runs axe in jsdom, and asserts the labelled add-control, the capability list,
// and the "all mapped" state.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import axe from 'axe-core';
import { AgentCapabilitiesEditor } from '../app/components/AgentCapabilitiesEditor.ts';
import type { AgentCapabilityMapping } from '../app/lib/db/agentCapabilities.ts';
import { ALL_ARTIFACT_TYPES } from '../app/lib/artifactTypes.ts';

const AVAILABLE = [...ALL_ARTIFACT_TYPES];

const MAPPING: AgentCapabilityMapping = {
  agent_id: 'content-generation',
  capabilities: [
    { artifact_type: 'release_blog', source: 'code-default' },
    { artifact_type: 'changelog_entry', source: 'operator-override' },
  ],
};

// An agent that already has every artifact type mapped → the "all mapped" branch (no add control).
const FULL_MAPPING: AgentCapabilityMapping = {
  agent_id: 'content-generation',
  capabilities: AVAILABLE.map((t) => ({ artifact_type: t, source: 'code-default' })),
};

function render(agents: readonly AgentCapabilityMapping[]): Document {
  const html = renderToStaticMarkup(
    createElement(
      'main',
      { id: 'main' },
      createElement(AgentCapabilitiesEditor, { agents, availableTypes: AVAILABLE }),
    ),
  );
  return new JSDOM(`<!doctype html><html lang="en"><body>${html}</body></html>`).window.document;
}

test('agent-capability editor has zero axe violations (partial and full)', async () => {
  for (const agents of [[MAPPING], [FULL_MAPPING]]) {
    const results = await axe.run(render(agents).body, {
      rules: { 'color-contrast': { enabled: false } },
    });
    assert.deepEqual(
      results.violations.map((v) => v.id),
      [],
    );
  }
});

test('the add-capability select is labelled and lists only unmapped types', () => {
  const doc = render([MAPPING]);
  const addId = 'add-content-generation';
  assert.ok(doc.querySelector(`#${addId}`), 'add select exists');
  assert.ok(doc.querySelector(`label[for="${addId}"]`), 'label for add select exists');
  // release_blog is already mapped → it must NOT be an option in the add select.
  const options = [...doc.querySelectorAll(`#${addId} option`)].map((o) => o.getAttribute('value'));
  assert.ok(!options.includes('release_blog'), 'mapped type is excluded from add options');
  assert.ok(options.includes('demo_script'), 'an unmapped type is offered');
});

test('each mapped capability renders a remove control with its source', () => {
  const doc = render([MAPPING]);
  const items = [...doc.querySelectorAll('[data-agent-cap]')].map((li) =>
    li.getAttribute('data-agent-cap'),
  );
  assert.deepEqual(items, ['release_blog', 'changelog_entry']);
  assert.ok(
    doc.querySelector('[data-agent-cap="release_blog"] button'),
    'a remove button exists per capability',
  );
});

test('an agent with every type mapped shows the all-mapped state, no add control', () => {
  const doc = render([FULL_MAPPING]);
  assert.ok(doc.querySelector('[data-all-added]'), 'all-mapped marker shown');
  assert.ok(!doc.querySelector('#add-content-generation'), 'no add select when nothing is addable');
});
