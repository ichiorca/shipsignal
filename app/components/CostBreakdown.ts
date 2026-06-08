// T5 (spec 011) — presentational per-node cost/latency breakdown for one run (PRD §6 cost/
// latency bar, §17 cost metrics). P6 (Quality bars / WCAG 2.2 AA): a semantic <table> with a
// <caption>, column <th scope="col">, a <tfoot> run-totals row whose label is a <th scope="row">,
// and the routed model tier conveyed as TEXT (a data-attribute lets CSS add colour as an
// enhancement, never the sole signal). All values are metrics only — node, model, tier, tokens,
// latency, USD estimate — so nothing sensitive renders (constitution §5).
//
// Authored with React.createElement (not JSX) so it renders under the dependency-free
// `node --test` a11y harness, mirroring the other components. Purely presentational — no client
// state — so it is Server-Component-safe.

import { createElement } from 'react';
import type { ReactElement } from 'react';
import type { CostByNode, CostTotals, RunCostBreakdown } from '@/app/lib/cost.ts';

export interface CostBreakdownProps {
  readonly breakdown: RunCostBreakdown;
}

/** USD with sub-cent precision (per-call estimates are fractions of a cent). */
function formatUsd(usd: number): string {
  return `$${usd.toFixed(4)}`;
}

/** Integer token/latency counts grouped for readability. */
function formatCount(n: number): string {
  return n.toLocaleString('en-US');
}

function nodeRow(node: CostByNode): ReactElement {
  return createElement(
    'tr',
    { key: `${node.node_name}:${node.model_id}`, 'data-node': node.node_name },
    createElement('th', { scope: 'row' }, node.node_name),
    // Tier as text; data-tier lets CSS colour-code without colour being the only signal.
    createElement('td', { 'data-tier': node.model_tier }, node.model_tier),
    createElement('td', null, node.model_id),
    createElement('td', null, formatCount(node.calls)),
    createElement('td', null, formatCount(node.input_tokens)),
    createElement('td', null, formatCount(node.output_tokens)),
    createElement('td', null, `${formatCount(node.latency_ms_total)} ms`),
    createElement('td', null, formatUsd(node.cost_usd)),
  );
}

function totalsRow(totals: CostTotals): ReactElement {
  return createElement(
    'tr',
    { 'data-totals': 'run' },
    // The footer label spans the node+tier+model identity columns; scope="row" names the row.
    createElement('th', { scope: 'row', colSpan: 3 }, 'Run total'),
    createElement('td', null, formatCount(totals.calls)),
    createElement('td', null, formatCount(totals.input_tokens)),
    createElement('td', null, formatCount(totals.output_tokens)),
    createElement('td', null, `${formatCount(totals.latency_ms_total)} ms`),
    createElement('td', null, formatUsd(totals.cost_usd)),
  );
}

const COLUMNS = [
  'Node',
  'Tier',
  'Model',
  'Calls',
  'Input tokens',
  'Output tokens',
  'Latency',
  'Est. cost',
] as const;

export function CostBreakdown({ breakdown }: CostBreakdownProps): ReactElement {
  const { byNode, totals } = breakdown;
  if (byNode.length === 0) {
    return createElement(
      'p',
      null,
      'No model-call telemetry has been recorded for this run yet.',
    );
  }
  return createElement(
    'table',
    null,
    createElement('caption', null, 'Model cost & latency by node'),
    createElement(
      'thead',
      null,
      createElement(
        'tr',
        null,
        ...COLUMNS.map((label) => createElement('th', { key: label, scope: 'col' }, label)),
      ),
    ),
    createElement('tbody', null, ...byNode.map(nodeRow)),
    createElement('tfoot', null, totalsRow(totals)),
  );
}
