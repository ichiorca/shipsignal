// UI tier-3 #8 — a tiny proportional "data bar" for tables (cost-vs-outcome, per-node cost). It is
// purely decorative (`aria-hidden`): the numeric value ALWAYS lives in the adjacent text cell, so
// the bar adds visual scannability without becoming the sole carrier of meaning (WCAG 2.2 AA). A
// CSS-width fill (no chart dependency, per the dependency policy) keeps it dependency-free and
// rendrable under the `node --test` harness.

import { createElement } from 'react';
import type { ReactElement } from 'react';

export interface MiniBarProps {
  readonly value: number;
  readonly max: number;
}

export function MiniBar({ value, max }: MiniBarProps): ReactElement {
  const ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return createElement(
    'span',
    { 'data-mini-bar': true, 'aria-hidden': true },
    createElement('span', { 'data-mini-bar-fill': true, style: { width: `${(ratio * 100).toFixed(1)}%` } }),
  );
}
