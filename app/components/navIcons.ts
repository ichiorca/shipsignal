// Sidebar/nav icon set — lucide-style inline SVGs, dependency-free (the project doesn't pull in an
// icon library). Mirrors the hindsight-guild sidebar look (Layers, BookOpen, Quote, Users, Brain,
// LineChart, FlaskConical, Activity, …). Every glyph is decorative: aria-hidden, sizes to 1em,
// inherits currentColor. Authored with React.createElement so it renders under the node --test
// a11y harness, like the other components.

import { createElement } from 'react';
import type { ReactElement } from 'react';

export type NavIconName =
  | 'dashboard'
  | 'inbox'
  | 'draft'
  | 'published'
  | 'signals'
  | 'skills'
  | 'capabilities'
  | 'voice'
  | 'agents'
  | 'learning'
  | 'quality'
  | 'experiments'
  | 'live'
  | 'admin';

// 24×24 stroke paths (no fills), single style covers light/dark via currentColor.
const PATHS: Readonly<Record<NavIconName, readonly string[]>> = {
  // TrendingUp
  dashboard: ['M16 7h6v6', 'm22 7-8.5 8.5-5-5L2 17'],
  // Inbox
  inbox: ['M22 12h-6l-2 3h-4l-2-3H2', 'M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z'],
  // PencilLine
  draft: ['M12 20h9', 'M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z'],
  // Send
  published: ['M22 2 11 13', 'm22 2-7 20-4-9-9-4z'],
  // Radar-ish (target)
  signals: ['M12 12a9 9 0 1 0 0-.01z', 'M12 12 7 7', 'M12 3v4', 'M12 17v4', 'M3 12h4', 'M17 12h4'],
  // Layers
  skills: ['m12 2 10 5-10 5L2 7l10-5z', 'm2 17 10 5 10-5', 'm2 12 10 5 10-5'],
  // BookOpen
  capabilities: ['M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z', 'M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z'],
  // Quote
  voice: ['M10 11H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v6c0 3-1 5-4 6', 'M20 11h-4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v6c0 3-1 5-4 6'],
  // Users
  agents: ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M22 21v-2a4 4 0 0 0-3-3.87', 'M16 3.13a4 4 0 0 1 0 7.75'],
  // Brain-ish (cpu)
  learning: ['M9 3a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 3 3', 'M15 3a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-2 5 3 3 0 0 1-3 3', 'M12 3v18'],
  // LineChart
  quality: ['M3 3v18h18', 'm19 9-5 5-4-4-3 3'],
  // FlaskConical
  experiments: ['M14 2v6a2 2 0 0 0 .24.96l5.5 10.08A2 2 0 0 1 18 22H6a2 2 0 0 1-1.74-2.96l5.5-10.08A2 2 0 0 0 10 8V2', 'M6.45 15h11.1', 'M8.5 2h7'],
  // Activity
  live: ['M22 12h-4l-3 9L9 3l-3 9H2'],
  // SlidersHorizontal
  admin: ['M3 6h11', 'M18 6h3', 'M3 12h3', 'M10 12h11', 'M3 18h8', 'M15 18h6', 'M16 4v4', 'M8 10v4', 'M13 16v4'],
};

export interface NavIconProps {
  readonly name: NavIconName;
}

/** A decorative inline nav icon (aria-hidden; inherits currentColor, sizes to 1em). */
export function NavIcon({ name }: NavIconProps): ReactElement {
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
      'data-nav-icon': name,
      style: { flexShrink: 0 },
    },
    ...PATHS[name].map((d, i) => createElement('path', { key: i, d })),
  );
}
