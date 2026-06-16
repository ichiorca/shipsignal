// Hero value metrics strip (operator feedback 2026-06-09, priority 2): the first thing a
// visitor sees is what the product DELIVERS — speed, spend vs PMM time, evidence-backing,
// output — not a bare run list. Pure presentational component over pre-computed aggregates
// (the page does the Aurora read); no 'use client' — it renders on the server.
// P6 (WCAG 2.2 AA): a labelled list of definition pairs; every value has its text label —
// nothing is conveyed by styling alone.

import { createElement } from 'react';
import type { ReactElement } from 'react';
import type { HeroStat } from '../lib/heroStats.ts';

export interface HeroStatsProps {
  readonly stats: readonly HeroStat[];
}

export function HeroStats({ stats }: HeroStatsProps): ReactElement {
  return createElement(
    'section',
    { 'aria-label': 'Release pipeline value', 'data-hero-stats': '' },
    createElement(
      'dl',
      null,
      ...stats.map((stat) =>
        createElement(
          'div',
          { key: stat.key, 'data-stat': stat.key },
          createElement('dt', null, stat.label),
          createElement(
            'dd',
            null,
            createElement('strong', { 'data-stat-value': '' }, stat.value),
            createElement('span', null, stat.detail),
          ),
        ),
      ),
    ),
  );
}
