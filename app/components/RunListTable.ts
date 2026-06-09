// T6 (spec 001) — presentational run-list table.
// P6 (Quality bars / WCAG 2.2 AA): semantic <table> with a <caption> and column
// <th scope="col">, status conveyed as text (not colour alone), and run ids exposed
// as keyboard-focusable links to the (future) run-detail route.
//
// Authored with React.createElement rather than JSX so this component renders under
// the dependency-free `node --test` harness (native TS stripping doesn't transform
// JSX); the behaviour is identical to the JSX form the page composes.

import { createElement } from 'react';
import type { ReactElement } from 'react';
import type { ReleaseRun } from '@/app/lib/db/releaseRuns.ts';
import { humanizeStatus, formatTimestamp } from '../lib/displayFormat.ts';

export interface RunListTableProps {
  readonly runs: readonly ReleaseRun[];
}

function shortId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

function statusCell(status: ReleaseRun['status']): ReactElement {
  // Humanized text label carries the meaning; the raw enum stays on the data-attribute so
  // CSS can add colour as an enhancement without making colour the sole signal.
  return createElement(
    'td',
    { 'data-status': status },
    createElement('span', null, humanizeStatus(status)),
  );
}

function runRow(run: ReleaseRun): ReactElement {
  const detailHref = `/releases/${run.id}`;
  return createElement(
    'tr',
    { key: run.id },
    // The run link is the row header so it names the row for screen readers (UX L4); the
    // full UUID stays on the link title while the cell shows the short, scannable id.
    createElement(
      'th',
      { scope: 'row' },
      createElement('a', { href: detailHref, title: run.id }, shortId(run.id)),
    ),
    createElement('td', null, run.repo),
    createElement('td', null, `${run.base_ref}…${run.head_ref}`),
    createElement('td', null, run.trigger_type),
    statusCell(run.status),
    // Machine-readable ISO stays in dateTime; the visible label is human-formatted (UX H2).
    createElement(
      'td',
      null,
      createElement('time', { dateTime: run.started_at }, formatTimestamp(run.started_at)),
    ),
  );
}

function emptyState(): ReactElement {
  return createElement(
    'tr',
    null,
    createElement(
      'td',
      { colSpan: 6 },
      'No release runs yet. Create one from a manual compare range or a release tag.',
    ),
  );
}

export function RunListTable({ runs }: RunListTableProps): ReactElement {
  const headers = ['Run', 'Repository', 'Compare range', 'Trigger', 'Status', 'Started'];
  return createElement(
    'table',
    null,
    createElement('caption', null, 'Release runs'),
    createElement(
      'thead',
      null,
      createElement(
        'tr',
        null,
        ...headers.map((label) =>
          createElement('th', { key: label, scope: 'col' }, label),
        ),
      ),
    ),
    createElement(
      'tbody',
      null,
      runs.length === 0 ? emptyState() : runs.map(runRow),
    ),
  );
}
