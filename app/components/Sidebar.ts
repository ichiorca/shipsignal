// Left sidebar shell — mirrors the hindsight-guild sidebar (logo tile, grouped sections with a
// tagline, per-item icon + label + description, active highlight). Replaces the old top nav so the
// two apps share an IA. P6 (WCAG 2.2 AA): a labelled <nav>, real links, aria-current on the active
// item; the section headers are a real list structure. Client component (usePathname) so the
// active item is computed per route. Authored with React.createElement for the test harness.

'use client';

import { createElement } from 'react';
import type { ReactElement } from 'react';
import { usePathname } from 'next/navigation';
import { SIDEBAR_SECTIONS, isNavItemActive, type SidebarItem } from '@/app/lib/sidebarNav.ts';
import { NavIcon } from './navIcons.ts';

function navItem(item: SidebarItem, pathname: string, badge: number | undefined): ReactElement {
  const active = isNavItemActive(pathname, item.href);
  // R3 — a live count of pending work (e.g. gates awaiting a decision). Rendered as TEXT with an
  // explicit aria-label (never colour/shape alone), and omitted entirely at zero so the badge only
  // ever signals "there is something to do here".
  const badgeEl =
    badge && badge > 0
      ? createElement(
          'span',
          {
            'data-nav-badge': true,
            'aria-label': `${badge} awaiting your review`,
          },
          String(badge),
        )
      : null;
  return createElement(
    'a',
    {
      key: item.href,
      href: item.href,
      'data-nav-link': true,
      ...(active ? { 'aria-current': 'page' } : {}),
    },
    createElement('span', { 'data-nav-item-icon': true }, createElement(NavIcon, { name: item.icon })),
    createElement(
      'span',
      { 'data-nav-item-text': true },
      createElement('span', { 'data-nav-item-label': true }, item.label),
      createElement('span', { 'data-nav-item-desc': true }, item.description),
    ),
    badgeEl,
  );
}

export interface SidebarProps {
  /** Live counts keyed by item href (e.g. { '/queue': 3 }); a positive value renders a badge. */
  readonly badges?: Readonly<Record<string, number>>;
}

export function Sidebar({ badges = {} }: SidebarProps): ReactElement {
  const pathname = usePathname() ?? '/';
  return createElement(
    'aside',
    { 'data-sidebar': true },
    // Brand block — gradient tile + wordmark (the hindsight-guild "h/g" pattern).
    createElement(
      'a',
      { href: '/', 'data-sidebar-brand': true },
      createElement('span', { 'data-brand-tile': true, 'aria-hidden': true }, 's/s'),
      createElement('span', { 'data-brand-name': true }, 'ShipSignal'),
    ),
    createElement(
      'nav',
      { 'aria-label': 'Primary', 'data-sidebar-nav': true },
      ...SIDEBAR_SECTIONS.map((section) =>
        createElement(
          'div',
          { key: section.title, 'data-nav-section': true },
          createElement(
            'div',
            { 'data-nav-section-head': true },
            createElement('p', { 'data-nav-section-title': true }, section.title),
            createElement('p', { 'data-nav-section-hint': true }, section.hint),
          ),
          ...section.items.map((item) => navItem(item, pathname, badges[item.href])),
        ),
      ),
    ),
  );
}
