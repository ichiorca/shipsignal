// Path B / Phase 1 — reusable section-hub layout. Each job tab (Distribute / Measure / Admin) lands
// on a hub that orients the user with a short "what this is for" intro and a set of destination
// cards. This keeps the four jobs feeling like coherent product areas instead of a flat list of
// engineering pages.
//
// P6 (WCAG 2.2 AA): the cards are a semantic <ul>; each card's title is a real link whose
// accessible name is the title text (the whole card is keyboard-focusable via that link); a card
// may be marked "soon" (a not-yet-built area) and then renders as plain text with an aria
// description rather than a dead link. Authored with React.createElement so it renders under the
// dependency-free `node --test` a11y harness.

import { createElement } from 'react';
import type { ReactElement } from 'react';

export interface HubCard {
  readonly title: string;
  readonly description: string;
  /** Destination route. Omit (with `soon: true`) for a not-yet-built area. */
  readonly href?: string;
  /** Mark a card as a roadmap placeholder — renders non-interactive with a "Coming soon" note. */
  readonly soon?: boolean;
}

export interface SectionHubProps {
  /** Uppercase section eyebrow above the title (matches the PageHeader pattern). */
  readonly eyebrow?: string;
  readonly title: string;
  readonly intro: string;
  readonly cards: readonly HubCard[];
}

function cardBody(card: HubCard): ReactElement {
  const title =
    card.href !== undefined && card.soon !== true
      ? createElement('a', { href: card.href }, card.title)
      : createElement('span', { 'data-card-title': true }, card.title);
  return createElement(
    'div',
    null,
    createElement('h2', null, title),
    createElement('p', null, card.description),
    card.soon === true
      ? createElement('p', { 'data-card-soon': true }, 'Coming soon')
      : null,
  );
}

export function SectionHub({ eyebrow, title, intro, cards }: SectionHubProps): ReactElement {
  return createElement(
    'section',
    { 'aria-labelledby': 'hub-heading', 'data-section-hub': true },
    eyebrow ? createElement('p', { 'data-eyebrow': true }, eyebrow) : null,
    createElement('h1', { id: 'hub-heading', 'data-page-title': true }, title),
    createElement('p', { 'data-hub-intro': true }, intro),
    createElement(
      'ul',
      { 'data-hub-cards': true },
      ...cards.map((card) =>
        createElement(
          'li',
          { key: card.title, 'data-hub-card': true, ...(card.soon === true ? { 'data-soon': true } : {}) },
          cardBody(card),
        ),
      ),
    ),
  );
}
