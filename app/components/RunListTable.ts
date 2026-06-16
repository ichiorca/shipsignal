// T6 (spec 001) — presentational run-list table. UI tier-1 #3: action-oriented — runs awaiting a
// human decision sort to the top, each row leads with a human label (repo · compare range) rather
// than an opaque UUID, carries its NEXT ACTION as a direct link, and shows a scannable relative
// time (absolute ISO stays in the `time` element + title).
// P6 (Quality bars / WCAG 2.2 AA): semantic <table> with a <caption> and column <th scope="col">,
// status conveyed as text (colour is a supplement), run links keyboard-focusable.
//
// Authored with React.createElement rather than JSX so this component renders under the
// dependency-free `node --test` harness (native TS stripping doesn't transform JSX).

import { createElement } from 'react';
import type { ReactElement } from 'react';
import type { ReleaseRun } from '@/app/lib/db/releaseRuns.ts';
import { EMPTY, humanizeStatus, formatTimestamp, relativeTime } from '../lib/displayFormat.ts';
import { isAwaitingReview, nextStep, statusCategory } from '../lib/runProgress.ts';

export interface RunListTableProps {
  readonly runs: readonly ReleaseRun[];
}

function statusCell(status: ReleaseRun['status']): ReactElement {
  // Humanized text label carries the meaning; the raw enum + its category stay on data-attrs so
  // CSS can add colour as an enhancement without making colour the sole signal.
  return createElement(
    'td',
    { 'data-status': status, 'data-status-category': statusCategory(status) },
    createElement('span', null, humanizeStatus(status)),
  );
}

function runLabelCell(run: ReleaseRun): ReactElement {
  // The run link is the row header so it names the row for screen readers. The human identity
  // (repo · compare range) leads; the full UUID stays discoverable on the link title.
  return createElement(
    'th',
    { scope: 'row' },
    createElement(
      'a',
      { href: `/releases/${run.id}`, title: run.id },
      createElement('strong', null, run.repo),
      createElement('span', { 'data-run-range': true }, ` · ${run.base_ref}…${run.head_ref}`),
    ),
  );
}

function nextActionCell(run: ReleaseRun): ReactElement {
  const next = nextStep(run);
  return createElement(
    'td',
    { 'data-next-action': next === null ? 'none' : 'pending' },
    next === null
      ? createElement('span', null, EMPTY)
      : createElement('a', { href: next.href }, `${next.label} →`),
  );
}

function runRow(run: ReleaseRun): ReactElement {
  return createElement(
    'tr',
    { key: run.id, 'data-status-category': statusCategory(run.status) },
    runLabelCell(run),
    createElement('td', null, humanizeStatus(run.trigger_type)),
    statusCell(run.status),
    nextActionCell(run),
    // Scannable relative time; the machine-readable ISO + full timestamp stay on the element.
    createElement(
      'td',
      null,
      createElement(
        'time',
        { dateTime: run.started_at, title: formatTimestamp(run.started_at) },
        relativeTime(run.started_at),
      ),
    ),
  );
}

function emptyState(): ReactElement {
  return createElement(
    'tr',
    null,
    createElement(
      'td',
      { colSpan: 5 },
      'No launches yet. Start one from a manual compare range or a release tag.',
    ),
  );
}

/** Runs awaiting a human decision float to the top; order within each group is preserved
 *  (the input is newest-first). Array.sort is stable in Node, so this keeps recency order. */
function awaitingFirst(runs: readonly ReleaseRun[]): readonly ReleaseRun[] {
  return [...runs].sort((a, b) => Number(isAwaitingReview(b)) - Number(isAwaitingReview(a)));
}

export function RunListTable({ runs }: RunListTableProps): ReactElement {
  const headers = ['Launch', 'Trigger', 'Status', 'Next action', 'Started'];
  const ordered = awaitingFirst(runs);
  return createElement(
    'table',
    null,
    createElement('caption', null, 'Launches'),
    createElement(
      'thead',
      null,
      createElement(
        'tr',
        null,
        ...headers.map((label) => createElement('th', { key: label, scope: 'col' }, label)),
      ),
    ),
    createElement(
      'tbody',
      null,
      ordered.length === 0 ? emptyState() : ordered.map(runRow),
    ),
  );
}
