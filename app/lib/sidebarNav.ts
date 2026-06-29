// Sidebar IA — single source of truth. Reorganized around the product's actual workflow funnel
// (UX review R1) rather than the peer app's borrowed three-section split, so the nav mirrors how
// the work flows — Create → Review → Distribute → Learn — instead of a different product's mental
// model. Sections:
//   - Overview     : the one-glance ROI + what needs you (the home dashboard).
//   - Workflow     : the end-to-end loop — start a launch, review its gates, see what shipped.
//   - Intelligence : observability — how the system learns and how it's performing.
//   - Library      : institutional knowledge — skills, capabilities, and the agent roster.
//   - Admin        : settings & connections hub.
//
// Every item maps to a ShipSignal route backed by real data. Stubbed concepts (Experiments) are
// intentionally NOT surfaced here until they have data (see R2). Brand Voice stays config under
// the Admin hub (/settings, /projects, /webhooks), not a top-level item (operator note 2026-06-22).

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
    title: 'Overview',
    hint: 'Your launches at a glance',
    items: [
      { href: '/', label: 'Dashboard', description: 'ROI + what needs you', icon: 'dashboard' },
    ],
  },
  {
    title: 'Workflow',
    hint: 'Release → content, end to end',
    items: [
      { href: '/draft', label: 'New Launch', description: 'Start a release → content', icon: 'draft' },
      { href: '/queue', label: 'Review Queue', description: 'Gates waiting on you', icon: 'inbox' },
      { href: '/distribute', label: 'Published', description: 'What shipped + where', icon: 'published' },
    ],
  },
  {
    title: 'Intelligence',
    hint: 'How the system learns & performs',
    items: [
      { href: '/learning', label: 'Self-Learning', description: 'How the team improves', icon: 'learning' },
      { href: '/telemetry', label: 'Quality Signals', description: 'Rubric + drift + AI citations', icon: 'quality' },
      // 'Experiments' (/experiments) is intentionally omitted: ShipSignal has no experiment data
      // model yet, so the route is an honest "coming soon" empty state. Surfacing it in the nav
      // reads as an unfinished product (UX review R2) — re-add it here once it is backed by data.
      { href: '/live', label: 'Live Ops', description: "What's running now", icon: 'live' },
    ],
  },
  {
    title: 'Library',
    hint: 'What the system knows',
    items: [
      { href: '/skills', label: 'Skills', description: 'Playbook versions', icon: 'skills' },
      { href: '/capabilities', label: 'Capabilities', description: 'Agent skills + usage', icon: 'capabilities' },
      { href: '/agents', label: 'Agents', description: 'Team roster + inboxes', icon: 'agents' },
    ],
  },
  {
    title: 'Admin',
    hint: 'Settings & connections',
    items: [
      { href: '/admin', label: 'Admin', description: 'Settings & connections', icon: 'admin' },
    ],
  },
];

/** True when `pathname` belongs to `item` (exact for '/', prefix otherwise). */
export function isNavItemActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}
