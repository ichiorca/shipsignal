// UI tier-2 #7 — a compact legend that collapses the ~12 raw lifecycle statuses into the four
// reviewer-facing buckets (Awaiting you / In progress / Done / Failed). Sits beside the run list
// so the status column reads as categories, not a wall of distinct phrases. P6 (WCAG 2.2 AA):
// each swatch carries its category name as TEXT (colour is a supplement); the group is labelled.
//
// Authored with React.createElement (not JSX) so it renders under the dependency-free harness.

import { createElement } from 'react';
import type { ReactElement } from 'react';
import { STATUS_CATEGORY_LABEL, type StatusCategory } from '../lib/runProgress.ts';

const ORDER: readonly StatusCategory[] = ['awaiting', 'in_progress', 'done', 'failed'];

export function StatusLegend(): ReactElement {
  return createElement(
    'div',
    { 'data-status-legend': true, role: 'group', 'aria-label': 'Status legend' },
    ...ORDER.map((category) =>
      createElement(
        'span',
        { key: category, 'data-status-category': category },
        STATUS_CATEGORY_LABEL[category],
      ),
    ),
  );
}
