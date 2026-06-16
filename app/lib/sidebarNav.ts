// Sidebar IA — single source of truth, mirroring the peer app (hindsight-guild) so the two can
// merge. Three sections matching how the operator reasons about the product:
//   - Decisions      : the daily transactional inbox (things needing a yes/no/edit).
//   - Skill library  : institutional knowledge — what the system knows & remembers.
//   - Signals & Trends: observability — what happened, what's happening, what's trending.
//
// Names + taglines are kept identical to hindsight-guild for a clean future merge, EXCEPT
// "Customer Voice" → "Brand Voice": ShipSignal grounds generation in the company/founder voice
// (the voice exemplars), not customer feedback (operator note 2026-06-16). Each item maps to a
// ShipSignal route backed by real data, or an honest "coming soon" where the concept has no
// ShipSignal equivalent yet (Agents roster, Experiments).

import type { NavIconName } from '@/app/components/navIcons.ts';

export interface SidebarItem {
  readonly href: string;
  readonly label: string;
  readonly description: string;
  readonly icon: NavIconName;
}

export interface SidebarSection {
  readonly title: string;
  readonly hint: string;
  readonly items: readonly SidebarItem[];
}

export const SIDEBAR_SECTIONS: readonly SidebarSection[] = [
  {
    title: 'Decisions',
    hint: 'What needs your call today',
    items: [
      { href: '/', label: 'Founder Dashboard', description: 'ROI & impact', icon: 'dashboard' },
      { href: '/queue', label: 'Approval Queue', description: 'Decide on launches', icon: 'inbox' },
      { href: '/draft', label: 'Drafting', description: 'Run the pipeline', icon: 'draft' },
      { href: '/distribute', label: 'Published', description: 'What shipped + where', icon: 'published' },
    ],
  },
  {
    title: 'Skill library',
    hint: 'What the system knows',
    items: [
      { href: '/skills', label: 'Skills', description: 'Playbook versions', icon: 'skills' },
      { href: '/capabilities', label: 'Capabilities', description: 'Agent skills + usage', icon: 'capabilities' },
      { href: '/voice', label: 'Brand Voice', description: 'Your founder voice', icon: 'voice' },
      { href: '/agents', label: 'Agents', description: 'Team roster + inboxes', icon: 'agents' },
    ],
  },
  {
    title: 'Signals & Trends',
    hint: "What's happened, what's happening",
    items: [
      { href: '/learning', label: 'Self-Learning', description: 'How the team improves', icon: 'learning' },
      { href: '/telemetry', label: 'Quality Signals', description: 'Rubric + drift + AI citations', icon: 'quality' },
      { href: '/experiments', label: 'Experiments', description: 'Hypotheses in flight', icon: 'experiments' },
      { href: '/live', label: 'Live Ops', description: "What's running now", icon: 'live' },
      { href: '/admin', label: 'Admin', description: 'Settings & connections', icon: 'admin' },
    ],
  },
];

/** True when `pathname` belongs to `item` (exact for '/', prefix otherwise). */
export function isNavItemActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}
