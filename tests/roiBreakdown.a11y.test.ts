// T5 (spec 021) — AC: the ROI view renders per-artifact-type cost next to ingested
// engagement, run totals include cost-per-click when both sides exist, and MISSING
// engagement renders as the text "not yet reported" — never as zero. Renders the real
// RoiBreakdown (the same component both the run-detail and cost pages compose) over
// PARTIAL data, runs axe in jsdom, and asserts the semantic-table structure plus the
// empty-state and totals contracts.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import axe from 'axe-core';
import { RoiBreakdown } from '../app/components/RoiBreakdown.ts';
import { buildRoiSummary } from '../app/lib/engagement.ts';
import { summarizeCost } from '../app/lib/cost.ts';
import type { CostByNode } from '../app/lib/cost.ts';
import type { EngagementByType, RoiSummary } from '../app/lib/engagement.ts';

const BY_NODE: readonly CostByNode[] = [
  {
    node_name: 'generate_',
    model_id: 'model-x',
    model_tier: 'standard',
    calls: 6,
    input_tokens: 6000,
    output_tokens: 3000,
    latency_ms_total: 900,
    cost_usd: 0.8,
  },
];

// Partial data on purpose: the blog has views+clicks (no conversions); the changelog has
// reported NOTHING — its whole row must read "not yet reported".
const ENGAGEMENT: readonly EngagementByType[] = [
  {
    artifact_type: 'release_blog',
    views: 1200,
    clicks: 40,
    conversions: null,
    latest_as_of: '2026-06-08',
  },
];

const SUMMARY: RoiSummary = buildRoiSummary(
  ['release_blog', 'changelog'],
  ENGAGEMENT,
  { byNode: BY_NODE, totals: summarizeCost(BY_NODE) },
);

function render(summary: RoiSummary): Document {
  const html = renderToStaticMarkup(
    createElement(
      'main',
      { id: 'main' },
      createElement('h1', null, 'Release run'),
      createElement(
        'section',
        { 'aria-labelledby': 'roi-heading' },
        createElement('h2', { id: 'roi-heading' }, 'Cost vs outcome'),
        createElement(RoiBreakdown, { summary }),
      ),
    ),
  );
  return new JSDOM(`<!doctype html><html lang="en"><body>${html}</body></html>`).window
    .document;
}

async function runAxe(doc: Document) {
  return axe.run(doc.body, { rules: { 'color-contrast': { enabled: false } } });
}

test('the ROI table has zero axe violations', async () => {
  const results = await runAxe(render(SUMMARY));
  assert.deepEqual(
    results.violations.map((v) => v.id),
    [],
    `axe violations: ${JSON.stringify(results.violations.map((v) => v.id))}`,
  );
});

test('semantic table: caption, column headers, and one row header per artifact type', () => {
  const doc = render(SUMMARY);
  assert.match(doc.querySelector('caption')?.textContent ?? '', /Cost vs outcome/);
  const cols = [...doc.querySelectorAll('thead th[scope="col"]')].map((th) => th.textContent);
  assert.deepEqual(cols, [
    'Artifact type',
    'Est. generation cost (apportioned)',
    'Views',
    'Clicks',
    'Conversions',
    'Reported as of',
  ]);
  const rowHeaders = [...doc.querySelectorAll('tbody th[scope="row"]')].map(
    (th) => th.textContent,
  );
  assert.deepEqual(rowHeaders, ['changelog', 'release_blog']);
});

test('partial data: missing engagement renders "not yet reported", never 0', () => {
  const doc = render(SUMMARY);
  const changelog = doc.querySelector('tr[data-artifact-type="changelog"]');
  const cells = [...(changelog?.querySelectorAll('td') ?? [])].map((td) => td.textContent);
  // cost, views, clicks, conversions, as-of
  assert.equal(cells[1], 'not yet reported');
  assert.equal(cells[2], 'not yet reported');
  assert.equal(cells[3], 'not yet reported');
  assert.ok(!cells.slice(1, 4).includes('0'), 'unreported never collapses to zero');

  const blog = doc.querySelector('tr[data-artifact-type="release_blog"]');
  const blogCells = [...(blog?.querySelectorAll('td') ?? [])].map((td) => td.textContent);
  assert.equal(blogCells[1], '1,200');
  assert.equal(blogCells[2], '40');
  assert.equal(blogCells[3], 'not yet reported'); // reported type, unreported metric
  assert.equal(blogCells[4], '2026-06-08');
});

test('run totals include cost-per-click when both sides exist', () => {
  const doc = render(SUMMARY);
  const totals = doc.querySelector('tfoot tr[data-totals="run"]');
  assert.match(totals?.textContent ?? '', /Run total/);
  // 0.8 USD / 40 clicks = $0.0200 per click.
  assert.match(totals?.textContent ?? '', /cost\/click: \$0\.0200/);
});

test('cost-per-click is n/a when no clicks were reported (never a fabricated number)', () => {
  const noEngagement = buildRoiSummary(['release_blog'], [], {
    byNode: BY_NODE,
    totals: summarizeCost(BY_NODE),
  });
  const doc = render(noEngagement);
  assert.match(
    doc.querySelector('tfoot')?.textContent ?? '',
    /cost\/click: n\/a/,
  );
});

test('a run with no artifacts degrades to an explanatory empty state', () => {
  const empty = buildRoiSummary([], [], { byNode: [], totals: summarizeCost([]) });
  const doc = render(empty);
  assert.equal(doc.querySelector('table'), null);
  assert.match(doc.body.textContent ?? '', /nothing to report engagement against/);
});
