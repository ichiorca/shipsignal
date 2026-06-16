// UI tier-1 #1 — the "Awaiting your review" queue (PRD §13.1). The dashboard's first question
// for a reviewer is "which runs need me NOW?" — the flat run feed never answered it. This island
// filters runs halted at a human gate and leads each with a direct call-to-action to that gate.
// P6 (WCAG 2.2 AA): a labelled <section>, an ordered list of real links (keyboard-operable), and
// status conveyed as text (the pill colour is a supplement). Reuses nextStep/statusCategory so
// the "what to do next" logic lives in exactly one place (app/lib/runProgress.ts).
//
// Authored with React.createElement (not JSX) so it renders under the dependency-free
// `node --test` a11y harness, mirroring the other components.

import { createElement } from 'react';
import type { ReactElement } from 'react';
import type { ReleaseRun } from '@/app/lib/db/releaseRuns.ts';
import { humanizeStatus, relativeTime } from '../lib/displayFormat.ts';
import { isAwaitingReview, nextStep, statusCategory } from '../lib/runProgress.ts';

export interface ReviewQueueProps {
  readonly runs: readonly ReleaseRun[];
}

function queueItem(run: ReleaseRun): ReactElement {
  const next = nextStep(run);
  // isAwaitingReview is the filter, so next is non-null here; guard keeps the type honest.
  const href = next?.href ?? `/releases/${run.id}`;
  const label = next?.label ?? 'Open run';
  return createElement(
    'li',
    { key: run.id, 'data-run-id': run.id },
    createElement(
      'div',
      { 'data-queue-identity': true },
      createElement('strong', null, run.repo),
      createElement('span', null, ` · ${run.base_ref}…${run.head_ref}`),
    ),
    createElement(
      'p',
      { 'data-status': run.status, 'data-status-category': statusCategory(run.status) },
      humanizeStatus(run.status),
    ),
    createElement(
      'span',
      { 'data-queue-age': true },
      createElement('time', { dateTime: run.started_at }, relativeTime(run.started_at)),
    ),
    createElement('a', { href, 'data-queue-cta': true }, `${label} →`),
  );
}

/** The gate-review work queue. Renders the runs awaiting a human decision, newest-first
 *  (the input order), each linking straight to its gate. A friendly empty state otherwise. */
export function ReviewQueue({ runs }: ReviewQueueProps): ReactElement {
  const awaiting = runs.filter(isAwaitingReview);
  return createElement(
    'section',
    { 'aria-labelledby': 'review-queue-heading', 'data-review-queue': true },
    createElement(
      'h2',
      { id: 'review-queue-heading' },
      awaiting.length === 0
        ? 'Awaiting your review'
        : `Awaiting your review (${awaiting.length})`,
    ),
    awaiting.length === 0
      ? createElement(
          'p',
          null,
          'Nothing is waiting on you right now. Runs halted at a gate (feature manifest or ' +
            'generated artifacts) will appear here.',
        )
      : createElement('ul', { 'data-queue-list': true }, ...awaiting.map(queueItem)),
  );
}
