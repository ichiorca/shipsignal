// UI tier-3 #11 — a minimal decorative inline-icon set. Every icon is `aria-hidden` and
// `focusable=false`: meaning ALWAYS lives in adjacent text, never in the glyph (WCAG 2.2 AA —
// colour/shape is a supplement, not the sole carrier). Icons inherit `currentColor` and size to
// `1em`, so they tint with their context and never need their own colour token.
//
// Authored with React.createElement (not JSX) so it renders under the dependency-free
// `node --test` harness, mirroring the other components.

import { createElement } from 'react';
import type { ReactElement } from 'react';

export type IconName =
  | 'check'
  | 'current'
  | 'alert'
  | 'upcoming'
  | 'halted'
  | 'arrow'
  | 'clock'
  | 'gate';

// 24×24 stroke paths (no fills) so a single style covers light/dark via currentColor.
const PATHS: Readonly<Record<IconName, readonly string[]>> = {
  check: ['M20 6 9 17l-5-5'],
  current: ['M5 12h14', 'M13 6l6 6-6 6'], // in-progress → arrow into the stage
  alert: ['M12 9v4', 'M12 17h.01', 'M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z'],
  upcoming: ['M12 7v.01', 'M12 12v.01', 'M12 17v.01'], // not-yet-reached → quiet dots
  halted: ['M18 6 6 18', 'M6 6l12 12'],
  arrow: ['M5 12h14', 'M13 6l6 6-6 6'],
  clock: ['M12 7v5l3 2', 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z'],
  gate: ['M4 4v16', 'M20 4v16', 'M4 8h16', 'M4 14h16'],
};

export interface IconProps {
  readonly name: IconName;
}

/** A decorative inline icon. Renders nothing to the accessibility tree (aria-hidden). */
export function Icon({ name }: IconProps): ReactElement {
  return createElement(
    'svg',
    {
      'aria-hidden': true,
      focusable: false,
      width: '1em',
      height: '1em',
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 2,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'data-icon': name,
      style: { verticalAlign: '-0.125em', flexShrink: 0 },
    },
    ...PATHS[name].map((d, i) => createElement('path', { key: i, d })),
  );
}
