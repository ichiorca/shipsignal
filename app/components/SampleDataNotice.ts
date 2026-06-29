// UX review R9 — an honest, low-key banner shown when the current view includes demo-seeded
// (synthetic) data, so a viewer (or a hackathon judge) always knows the numbers are sample data,
// not a real deployment's. Reinforces the product's "we never fabricate numbers" stance. Pure
// presentational server component (no 'use client', no data reads) — the caller decides `show`
// from hasSyntheticRun(runs). P6 (WCAG 2.2 AA): a labelled note conveyed as TEXT (an explicit
// "Sample data" label), never colour alone.
//
// Authored with React.createElement (not JSX) so it renders under the dependency-free
// `node --test` a11y harness, mirroring the other components.

import { createElement } from 'react';
import type { ReactElement } from 'react';

export interface SampleDataNoticeProps {
  /** Whether any synthetic/demo-seeded run is present in the current view. */
  readonly show: boolean;
}

export function SampleDataNotice({ show }: SampleDataNoticeProps): ReactElement | null {
  if (!show) return null;
  return createElement(
    'aside',
    { 'data-sample-data-notice': '', role: 'note', 'aria-label': 'Sample data notice' },
    createElement('span', { 'data-sample-tag': '' }, 'Sample data'),
    createElement(
      'span',
      null,
      'This view includes a synthetic, demo-seeded release so you can explore the full loop. ' +
        'Real runs you create appear alongside it.',
    ),
  );
}
