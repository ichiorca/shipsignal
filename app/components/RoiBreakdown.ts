// T5 (spec 021) — presentational cost-vs-outcome breakdown for one run (PRD §17.1 outcome
// extension): per artifact type, the apportioned generation cost next to the ingested
// aggregate engagement, plus run totals with cost-per-click — turning the cost view from
// "what we spent" into "what we got". P6 (WCAG 2.2 AA): a semantic <table> with a
// <caption>, column <th scope="col">, row <th scope="row">, and a <tfoot> totals row.
// Missing engagement renders as the TEXT "not yet reported" — never 0, never colour/style
// alone (spec AC). All values are aggregate metrics; nothing user-level exists in the shape.
//
// Authored with React.createElement (not JSX) so it renders under the dependency-free
// `node --test` a11y harness, mirroring CostBreakdown. Purely presentational — no client
// state — so it is Server-Component-safe.

import { createElement } from 'react';
import type { ReactElement } from 'react';
import type { RoiRow, RoiSummary } from '@/app/lib/engagement.ts';

export interface RoiBreakdownProps {
  readonly summary: RoiSummary;
}

const NOT_REPORTED = 'not yet reported';

/** USD with sub-cent precision (matches CostBreakdown's formatting). */
function formatUsd(usd: number): string {
  return `$${usd.toFixed(4)}`;
}

/** An aggregate count, or the explicit "not yet reported" empty state (never 0). */
function formatReported(value: number | null): string {
  return value === null ? NOT_REPORTED : value.toLocaleString('en-US');
}

function typeRow(row: RoiRow): ReactElement {
  return createElement(
    'tr',
    { key: row.artifact_type, 'data-artifact-type': row.artifact_type },
    createElement('th', { scope: 'row' }, row.artifact_type),
    createElement(
      'td',
      null,
      row.apportioned_cost_usd === null ? 'n/a' : `~${formatUsd(row.apportioned_cost_usd)}`,
    ),
    createElement('td', null, formatReported(row.views)),
    createElement('td', null, formatReported(row.clicks)),
    createElement('td', null, formatReported(row.conversions)),
    createElement('td', null, row.latest_as_of ?? '—'),
  );
}

function totalsRow(summary: RoiSummary): ReactElement {
  return createElement(
    'tr',
    { 'data-totals': 'run' },
    createElement('th', { scope: 'row' }, 'Run total'),
    createElement('td', null, formatUsd(summary.run_cost_usd)),
    createElement('td', null, formatReported(summary.total_views)),
    createElement('td', null, formatReported(summary.total_clicks)),
    createElement('td', null, formatReported(summary.total_conversions)),
    createElement(
      'td',
      { 'data-cost-per-click': summary.cost_per_click_usd ?? 'n/a' },
      summary.cost_per_click_usd === null
        ? 'cost/click: n/a'
        : `cost/click: ${formatUsd(summary.cost_per_click_usd)}`,
    ),
  );
}

const COLUMNS = [
  'Artifact type',
  'Est. generation cost (apportioned)',
  'Views',
  'Clicks',
  'Conversions',
  'Reported as of',
] as const;

export function RoiBreakdown({ summary }: RoiBreakdownProps): ReactElement {
  if (summary.rows.length === 0) {
    return createElement(
      'p',
      null,
      'No artifacts have been generated for this run yet, so there is nothing to report ' +
        'engagement against.',
    );
  }
  return createElement(
    'table',
    null,
    createElement(
      'caption',
      null,
      'Cost vs outcome by artifact type. Generation cost is the run’s artifact-' +
        'generation model spend apportioned evenly across types (telemetry is recorded ' +
        'per routing node, not per artifact type).',
    ),
    createElement(
      'thead',
      null,
      createElement(
        'tr',
        null,
        ...COLUMNS.map((label) => createElement('th', { key: label, scope: 'col' }, label)),
      ),
    ),
    createElement('tbody', null, ...summary.rows.map(typeRow)),
    createElement('tfoot', null, totalsRow(summary)),
  );
}
