// Frontend audit — AC: the provenance/lineage view passes axe/keyboard checks (WCAG 2.2 AA),
// conveys support/risk as text, and rolls trust up correctly. Renders the real ProvenanceLineage
// component (the same one the page composes) to static markup, runs axe-core in jsdom, and asserts
// the rollup figures + the summarizeProvenance maths.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import axe from 'axe-core';
import { ProvenanceLineage } from '../app/components/ProvenanceLineage.ts';
import { summarizeProvenance } from '../app/lib/provenanceView.ts';
import type { ArtifactWithClaims } from '../app/lib/db/claims.ts';

const ARTIFACT: ArtifactWithClaims = {
  id: 'art-1111-2222-3333',
  release_run_id: 'run-aaaa',
  artifact_type: 'release_blog',
  title: 'Launch blog',
  body_markdown: '# Launch',
  status: 'approved',
  claims: [
    {
      id: 'claim-1',
      artifact_id: 'art-1111-2222-3333',
      claim_text: 'Cuts deploy time by 40%.',
      claim_type: 'performance',
      support_status: 'supported',
      risk_level: 'medium',
      evidence: [
        { evidence_item_id: 'ev-1', evidence_type: 'pr', redacted_excerpt: 'perf bench', support_score: 0.82 },
        { evidence_item_id: 'ev-2', evidence_type: 'commit', redacted_excerpt: 'cache layer', support_score: 0.61 },
      ],
    },
    {
      id: 'claim-2',
      artifact_id: 'art-1111-2222-3333',
      claim_text: 'Most reliable release ever.',
      claim_type: 'comparison',
      support_status: 'unsupported',
      risk_level: 'high',
      evidence: [],
    },
  ],
};

function render(artifact: ArtifactWithClaims): Document {
  const html = renderToStaticMarkup(
    createElement(
      'main',
      { id: 'main' },
      createElement(ProvenanceLineage, {
        artifact,
        summary: summarizeProvenance(artifact.claims),
      }),
    ),
  );
  return new JSDOM(`<!doctype html><html lang="en"><body>${html}</body></html>`).window.document;
}

async function runAxe(doc: Document) {
  return axe.run(doc.body, { rules: { 'color-contrast': { enabled: false } } });
}

test('populated provenance view has zero axe violations', async () => {
  const results = await runAxe(render(ARTIFACT));
  assert.deepEqual(
    results.violations.map((v) => v.id),
    [],
    `axe violations: ${JSON.stringify(results.violations.map((v) => v.id))}`,
  );
});

test('empty-claims provenance view has zero axe violations', async () => {
  const results = await runAxe(render({ ...ARTIFACT, claims: [] }));
  assert.deepEqual(results.violations.map((v) => v.id), []);
});

test('summarizeProvenance rolls up supported / linked / high-risk correctly', () => {
  const s = summarizeProvenance(ARTIFACT.claims);
  assert.equal(s.totalClaims, 2);
  assert.equal(s.supported, 1);
  assert.equal(s.unsupported, 1);
  assert.equal(s.evidenceLinked, 1);
  assert.equal(s.highRisk, 1);
  assert.equal(s.evidenceLinks, 2);
  assert.equal(s.trustRatio, 0.5);
});

test('the trust headline states the evidence-linked ratio as text', () => {
  const doc = render(ARTIFACT);
  assert.match(
    doc.querySelector('[data-trust-headline]')?.textContent ?? '',
    /50% of claims are evidence-linked/,
  );
});

test('an unsupported claim states it is not grounded (not colour alone)', () => {
  const doc = render(ARTIFACT);
  const none = doc.querySelector('[data-evidence="none"]')?.textContent ?? '';
  assert.match(none, /not grounded/);
});

test('strongest grounding score is surfaced per claim', () => {
  const doc = render(ARTIFACT);
  const best = doc.querySelector('[data-strongest-support]')?.getAttribute('data-strongest-support');
  assert.equal(best, '0.82');
});
