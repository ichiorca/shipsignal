// UX review R9 (time-to-wow) — the empty-deployment hero. When no runs exist yet, the dashboard
// should not show four "—" stats and an empty table; it should sell the product in one screen and
// drive the single highest-value first action: seed a fully-populated sample run and land in
// generated content awaiting approval (zero → wow in one click). A real launch is offered as the
// secondary path. Presentational server component (no 'use client'); it hosts the interactive
// LoadSampleButton (a client leaf) and a plain link to /draft.
//
// Authored with React.createElement (not JSX) so it renders under the dependency-free
// `node --test` a11y harness, mirroring the other components. P6 (WCAG 2.2 AA): one labelled
// <section> led by a heading; the value props are a semantic list; actions are a real button +
// link with visible text (never colour alone).

import { createElement } from 'react';
import type { ReactElement } from 'react';
import { LoadSampleButton } from './LoadSampleButton.ts';

const VALUE_PROPS: readonly string[] = [
  'Turns a git tag into publish-ready content in minutes — blog, changelog, social, demo script.',
  'Every claim is traceable to the diff that earned it; nothing is generated from raw diffs.',
  'You stay in control: three human approval gates before anything publishes.',
];

export function FirstRunHero(): ReactElement {
  return createElement(
    'section',
    { 'aria-labelledby': 'first-run-hero-heading', 'data-first-run-hero': '' },
    createElement('p', { 'data-hero-eyebrow': '' }, 'Welcome to ShipSignal'),
    createElement(
      'h2',
      { id: 'first-run-hero-heading' },
      'From a release to evidence-backed launch content — in minutes',
    ),
    createElement(
      'ul',
      { 'data-hero-points': '' },
      ...VALUE_PROPS.map((point) =>
        createElement('li', { key: point }, point),
      ),
    ),
    // Primary action: the one-click wow. LoadSampleButton owns its own heading/copy/live region.
    createElement(
      'div',
      { 'data-hero-actions': '' },
      createElement(LoadSampleButton, null),
      createElement(
        'p',
        { 'data-hero-secondary': '' },
        'Have a repository ready? ',
        createElement('a', { href: '/draft' }, 'Start a real launch instead'),
        '.',
      ),
    ),
  );
}
