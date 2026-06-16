// Path B / Phase 4 — the Distribute "what's queued" view: scheduled posts (soonest pending first,
// then recent), so an operator can see what will ship and when. P6 (WCAG 2.2 AA): a semantic
// <table> with a <caption> and column <th scope="col">; status + channel render as TEXT (a
// data-attribute adds colour as an enhancement, never the sole signal). Purely presentational —
// Server-Component-safe; authored with React.createElement for the dependency-free harness.

import { createElement } from 'react';
import type { ReactElement } from 'react';
import type { ScheduledPublishView } from '../lib/scheduledPublish.ts';
import { humanizeStatus, formatTimestamp } from '../lib/displayFormat.ts';

export interface ScheduleQueueProps {
  readonly schedules: readonly ScheduledPublishView[];
}

const HEADERS = ['Channel', 'Scheduled', 'Status', 'Artifact'];

const STATUS_CATEGORY: Record<string, string> = {
  pending: 'awaiting',
  sending: 'in_progress',
  sent: 'done',
  failed: 'failed',
  cancelled: 'in_progress',
};

function row(s: ScheduledPublishView): ReactElement {
  return createElement(
    'tr',
    { key: s.id, 'data-schedule-id': s.id },
    createElement('th', { scope: 'row' }, s.channel === 'x' ? 'X' : 'LinkedIn'),
    createElement(
      'td',
      null,
      createElement(
        'time',
        { dateTime: s.scheduled_at, title: formatTimestamp(s.scheduled_at) },
        formatTimestamp(s.scheduled_at),
      ),
    ),
    createElement(
      'td',
      { 'data-status': s.status, 'data-status-category': STATUS_CATEGORY[s.status] ?? 'in_progress' },
      createElement('span', null, humanizeStatus(s.status)),
      s.status === 'failed' && s.last_error !== null
        ? createElement('span', { 'data-schedule-error': true }, ` — ${s.last_error}`)
        : null,
    ),
    createElement(
      'td',
      null,
      createElement('a', { href: `/artifacts/${s.artifact_id}`, title: s.artifact_id }, 'View post'),
    ),
  );
}

export function ScheduleQueue({ schedules }: ScheduleQueueProps): ReactElement {
  return createElement(
    'table',
    null,
    createElement('caption', null, 'Scheduled posts'),
    createElement(
      'thead',
      null,
      createElement(
        'tr',
        null,
        ...HEADERS.map((h) => createElement('th', { key: h, scope: 'col' }, h)),
      ),
    ),
    createElement(
      'tbody',
      null,
      schedules.length === 0
        ? createElement(
            'tr',
            null,
            createElement(
              'td',
              { colSpan: HEADERS.length },
              'No posts scheduled. Approve a post and schedule it from its actions (with PUBLISH_MODE=scheduled).',
            ),
          )
        : schedules.map(row),
    ),
  );
}
