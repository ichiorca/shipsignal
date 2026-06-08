// T5 (spec 013) — presentational per-run eval dashboard (PRD §17.1 metrics, §13.1 Eval
// dashboard). P6 (Quality bars / WCAG 2.2 AA): a semantic <table> with a <caption>, column
// <th scope="col">, and each metric row's name as a <th scope="row">; the score is conveyed as
// TEXT (a data-attribute lets CSS add emphasis as an enhancement, never the sole signal). The
// rubric headline renders as a <caption>-adjacent <p>. All values are metric scores + counts —
// nothing sensitive renders (constitution §5).
//
// Authored with React.createElement (not JSX) so it renders under the dependency-free
// `node --test` a11y harness, mirroring the other components. Purely presentational — no client
// state — so it is Server-Component-safe.

import { createElement } from 'react';
import type { ReactElement } from 'react';
import type { EvalMetric, RunEvalSummary } from '@/app/lib/evalMetrics.ts';

export interface EvalDashboardProps {
  readonly summary: RunEvalSummary;
}

function metricRow(metric: EvalMetric): ReactElement {
  return createElement(
    'tr',
    { key: metric.name, 'data-metric': metric.name },
    createElement('th', { scope: 'row' }, metric.label),
    // Score as text; data-score lets CSS emphasise without value being conveyed by style alone.
    createElement('td', { 'data-score': metric.display }, metric.display),
    createElement('td', null, metric.detail),
  );
}

const COLUMNS = ['Metric', 'Score', 'Detail'] as const;

function rubricCaption(summary: RunEvalSummary): ReactElement {
  if (summary.rubricCount === 0) {
    return createElement(
      'p',
      { 'data-rubric': 'empty' },
      'No LLM-as-judge rubric scores have been recorded for this run yet.',
    );
  }
  const avg = summary.rubricAverage?.toFixed(2) ?? 'n/a';
  return createElement(
    'p',
    { 'data-rubric': 'summary' },
    `LLM-as-judge rubric: average ${avg} / 5 across ${summary.rubricCount} ` +
      `artifact${summary.rubricCount === 1 ? '' : 's'}.`,
  );
}

export function EvalDashboard({ summary }: EvalDashboardProps): ReactElement {
  return createElement(
    'section',
    { 'aria-labelledby': 'eval-metrics-heading' },
    createElement('h2', { id: 'eval-metrics-heading' }, 'Evaluation metrics'),
    rubricCaption(summary),
    createElement(
      'table',
      null,
      createElement('caption', null, 'Product-quality metrics for this release run'),
      createElement(
        'thead',
        null,
        createElement(
          'tr',
          null,
          ...COLUMNS.map((label) =>
            createElement('th', { key: label, scope: 'col' }, label),
          ),
        ),
      ),
      createElement('tbody', null, ...summary.metrics.map(metricRow)),
    ),
  );
}
