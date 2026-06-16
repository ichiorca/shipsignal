// Frontend audit — reusable accessible bar chart. The cost/eval/trends surfaces previously had
// only read-only tables plus a decorative MiniBar; this gives a real "where it goes / how it
// trends" visualization without a charting dependency (dependency-policy: prefer existing
// primitives) and without sacrificing accessibility.
//
// P6 (WCAG 2.2 AA): this is NOT an opaque <canvas>/SVG image. Each datum renders as real text —
// a <th> row label and a numeric <td> value — inside a semantic <table>, so the data is fully
// available to screen readers and keyboard users; the proportional bar is an aria-hidden CSS fill
// layered behind the value, exactly like MiniBar, so colour/length is an ENHANCEMENT, never the
// sole carrier of meaning. An optional per-row href makes a datum a drill-down link.
//
// Authored with React.createElement (not JSX) so it renders under the dependency-free
// `node --test` a11y harness. Purely presentational — Server-Component-safe.

import { createElement } from 'react';
import type { ReactElement } from 'react';

export interface BarDatum {
  readonly label: string;
  readonly value: number;
  /** Optional drill-down target — when set, the row label becomes a keyboard-focusable link. */
  readonly href?: string;
  /** Optional title/tooltip for the row label (e.g. a full id behind a short label). */
  readonly title?: string;
}

export interface BarChartProps {
  readonly caption: string;
  readonly data: readonly BarDatum[];
  /** Header for the value column (e.g. 'Est. cost', 'Edit distance'). */
  readonly valueHeader: string;
  /** Header for the label column (e.g. 'Node', 'Run'). Defaults to 'Item'. */
  readonly labelHeader?: string;
  /** Render a raw numeric value as display text (e.g. USD, percent). Defaults to en-US number. */
  readonly formatValue?: (value: number) => string;
  /** Empty-state message when there is no data. */
  readonly emptyMessage?: string;
  /** Fixed axis maximum so bars are proportional to a known scale (e.g. 5 for a 1..5 rubric)
   *  rather than to the largest datum. Defaults to the max value in `data`. */
  readonly max?: number;
}

function defaultFormat(value: number): string {
  return value.toLocaleString('en-US');
}

function labelContent(datum: BarDatum): ReactElement | string {
  if (datum.href !== undefined) {
    return createElement(
      'a',
      { href: datum.href, ...(datum.title !== undefined ? { title: datum.title } : {}) },
      datum.label,
    );
  }
  if (datum.title !== undefined) {
    return createElement('span', { title: datum.title }, datum.label);
  }
  return datum.label;
}

function barRow(
  datum: BarDatum,
  index: number,
  max: number,
  format: (v: number) => string,
): ReactElement {
  const ratio = max > 0 ? Math.max(0, Math.min(1, datum.value / max)) : 0;
  return createElement(
    'tr',
    // Composite key: labels are not guaranteed unique (e.g. a node grouped across models), so
    // pair the label with its index to keep keys collision-proof for this static, non-reordered list.
    { key: `${datum.label}-${index}`, 'data-bar-row': true },
    createElement('th', { scope: 'row' }, labelContent(datum)),
    createElement(
      'td',
      null,
      // The proportional fill sits behind the value as aria-hidden decoration; the number is the
      // accessible carrier. `data-bar-cell`/`data-bar-fill` are the CSS hooks (see globals.css).
      createElement(
        'span',
        { 'data-bar-cell': true },
        createElement('span', {
          'data-bar-fill': true,
          'aria-hidden': true,
          style: { width: `${(ratio * 100).toFixed(1)}%` },
        }),
        createElement('span', { 'data-bar-value': true, 'data-metric-value': true }, format(datum.value)),
      ),
    ),
  );
}

export function BarChart({
  caption,
  data,
  valueHeader,
  labelHeader = 'Item',
  formatValue = defaultFormat,
  emptyMessage = 'No data to chart yet.',
  max,
}: BarChartProps): ReactElement {
  if (data.length === 0) {
    return createElement('p', null, emptyMessage);
  }
  // A caller-supplied scale ceiling (e.g. 5 for a rubric) wins; otherwise scale to the largest datum.
  const axisMax = max ?? data.reduce((m, d) => Math.max(m, d.value), 0);
  return createElement(
    'table',
    { 'data-bar-chart': true },
    createElement('caption', null, caption),
    createElement(
      'thead',
      null,
      createElement(
        'tr',
        null,
        createElement('th', { scope: 'col' }, labelHeader),
        createElement('th', { scope: 'col' }, valueHeader),
      ),
    ),
    createElement('tbody', null, ...data.map((d, i) => barRow(d, i, axisMax, formatValue))),
  );
}
