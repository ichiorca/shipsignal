// UX review R10 — the conversion funnel: generated → approved → published → engaged. Closes the
// ROI loop from "we made content" to "it drove results" — the slide a marketer wants. Pure
// presentational server component over pre-computed counts (the page does the Aurora read).
// P6 (WCAG 2.2 AA): a labelled <section> with an ordered list of stages; each stage's count and
// conversion are TEXT (the bar width is a visual supplement, never the sole signal); the bar is
// aria-hidden and the numbers carry the meaning.
//
// Authored with React.createElement (not JSX) so it renders under the dependency-free
// `node --test` a11y harness, mirroring the other components.

import { createElement } from 'react';
import type { ReactElement } from 'react';
import { buildFunnel, funnelIsEmpty, type FunnelCounts } from '../lib/funnel.ts';

export interface ConversionFunnelProps {
  readonly counts: FunnelCounts;
}

export function ConversionFunnel({ counts }: ConversionFunnelProps): ReactElement {
  if (funnelIsEmpty(counts)) {
    return createElement(
      'section',
      { 'aria-labelledby': 'funnel-heading', 'data-conversion-funnel': '' },
      createElement('h2', { id: 'funnel-heading' }, 'Content funnel'),
      createElement(
        'p',
        null,
        'No content yet — the funnel from generated → approved → published → engaged appears once ' +
          'your first launch produces drafts.',
      ),
    );
  }

  const stages = buildFunnel(counts);
  return createElement(
    'section',
    { 'aria-labelledby': 'funnel-heading', 'data-conversion-funnel': '' },
    createElement('h2', { id: 'funnel-heading' }, 'Content funnel'),
    createElement(
      'p',
      { 'data-funnel-caption': '' },
      'From generated drafts to recorded engagement — the whole ROI loop.',
    ),
    createElement(
      'ol',
      { 'data-funnel-stages': '' },
      ...stages.map((stage) =>
        createElement(
          'li',
          { key: stage.key, 'data-funnel-stage': stage.key },
          createElement(
            'div',
            { 'data-funnel-row': '' },
            createElement('span', { 'data-funnel-label': '' }, stage.label),
            createElement(
              'span',
              { 'data-funnel-count': '' },
              `${stage.count}`,
              // Step-over-step conversion as text (null for the first stage).
              stage.stepPct === null
                ? null
                : createElement(
                    'span',
                    { 'data-funnel-step': '' },
                    ` · ${stage.stepPct}% of previous`,
                  ),
            ),
          ),
          // The bar is decorative: the count + conversion above already convey the value.
          createElement('div', {
            'data-funnel-bar': '',
            'aria-hidden': true,
            style: { width: `${Math.max(stage.pctOfTop, 2)}%` },
          }),
        ),
      ),
    ),
  );
}
