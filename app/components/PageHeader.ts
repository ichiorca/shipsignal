// Page header — mirrors hindsight-guild's PageHeader: an uppercase primary "eyebrow", a serif
// title, and a muted description, with an optional actions slot. Every reskinned page leads with
// this so the two apps read the same. P6 (WCAG 2.2 AA): the title is the page <h1>; the eyebrow is
// decorative context. Authored with React.createElement for the test harness; purely presentational.

import { createElement } from 'react';
import type { ReactElement, ReactNode } from 'react';

export interface PageHeaderProps {
  /** Uppercase context label above the title (e.g. the section name). */
  readonly eyebrow?: string;
  readonly title: string;
  readonly description?: string;
  /** Optional right-aligned actions (buttons/links). */
  readonly actions?: ReactNode;
}

export function PageHeader({ eyebrow, title, description, actions }: PageHeaderProps): ReactElement {
  return createElement(
    'header',
    { 'data-page-header': true },
    createElement(
      'div',
      { 'data-page-header-text': true },
      eyebrow ? createElement('p', { 'data-eyebrow': true }, eyebrow) : null,
      createElement('h1', { 'data-page-title': true }, title),
      description ? createElement('p', { 'data-page-desc': true }, description) : null,
    ),
    actions ? createElement('div', { 'data-page-header-actions': true }, actions) : null,
  );
}
