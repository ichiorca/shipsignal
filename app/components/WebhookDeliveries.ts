// Frontend audit — webhook delivery dashboard. The outbound distribution webhook has a full
// audited, HMAC-signed, retried delivery ledger (app/lib/outboundWebhook.ts +
// db/outboundWebhookDeliveries.ts) and inbound GitHub deliveries are deduped in
// db/webhookDeliveries.ts — but neither had ANY UI. This is the operability surface: a status
// summary strip plus two semantic tables (outbound deliveries, inbound activity log).
//
// P6 (Quality bars / WCAG 2.2 AA): semantic <table>s with <caption> + column <th scope="col">;
// delivery state is conveyed as TEXT (a data-status attribute lets CSS add colour as an
// enhancement, never the sole signal); the summary uses a <dl> so each count has a programmatic
// label. constitution §5: only metadata renders — target URL (operator config), event type,
// attempt count, HTTP status, a secret-free error string, timestamps — never a payload or secret.
//
// Authored with React.createElement (not JSX) so it renders under the dependency-free
// `node --test` a11y harness. Purely presentational — Server-Component-safe.

import { createElement } from 'react';
import type { ReactElement } from 'react';
import type {
  OutboundDeliveryRow,
  OutboundDeliveryTotals,
  InboundDeliveryRow,
} from '@/app/lib/webhookDeliveryView.ts';
// Runtime import via relative path (not the @/ alias) so this renders under the dependency-free
// `node --test` a11y harness, which doesn't resolve the tsconfig path alias for value imports.
import { deliveryState } from '../lib/webhookDeliveryView.ts';
import { EMPTY, humanizeStatus, formatTimestamp, relativeTime } from '../lib/displayFormat.ts';

export interface WebhookDeliveriesProps {
  readonly outbound: readonly OutboundDeliveryRow[];
  readonly inbound: readonly InboundDeliveryRow[];
  readonly totals: OutboundDeliveryTotals;
}

// Map the shared delivery-state bucket to the visible label + the status-category CSS uses for
// colour. Text label always carries the meaning (colour is an enhancement, WCAG 2.2 AA).
const STATE_PRESENTATION = {
  delivered: { label: 'Delivered', category: 'done' },
  failed: { label: 'Failed', category: 'failed' },
  pending: { label: 'Pending', category: 'awaiting' },
} as const;

function shortId(value: string): string {
  return value.length > 12 ? `${value.slice(0, 12)}…` : value;
}

function summaryStrip(totals: OutboundDeliveryTotals): ReactElement {
  const items: ReadonlyArray<{ readonly label: string; readonly value: number; readonly key: string }> = [
    { label: 'Total', value: totals.total, key: 'total' },
    { label: 'Delivered', value: totals.delivered, key: 'delivered' },
    { label: 'Failed', value: totals.failed, key: 'failed' },
    { label: 'Pending', value: totals.pending, key: 'pending' },
  ];
  return createElement(
    'dl',
    { 'data-hero-stats': true },
    ...items.map((item) =>
      createElement(
        'div',
        { key: item.key, 'data-delivery-stat': item.key },
        createElement('dt', null, item.label),
        createElement(
          'dd',
          null,
          createElement('span', { 'data-stat-value': true }, item.value.toLocaleString('en-US')),
        ),
      ),
    ),
  );
}

const OUTBOUND_HEADERS = [
  'Event',
  'Artifact',
  'Target',
  'Attempts',
  'Last status',
  'State',
  'Updated',
];

function outboundRow(row: OutboundDeliveryRow): ReactElement {
  const state = STATE_PRESENTATION[deliveryState(row)];
  return createElement(
    'tr',
    { key: row.delivery_id, 'data-delivery-id': row.delivery_id },
    // The event + a link to the originating run names the row for screen readers.
    createElement(
      'th',
      { scope: 'row' },
      createElement(
        'a',
        { href: `/releases/${row.release_run_id}`, title: row.release_run_id },
        humanizeStatus(row.event_type),
      ),
    ),
    createElement(
      'td',
      null,
      createElement(
        'a',
        { href: `/artifacts/${row.artifact_id}`, title: row.artifact_id },
        createElement('code', null, shortId(row.artifact_id)),
      ),
    ),
    // Target host only in the cell text; full URL on the title (it is operator config, not secret).
    createElement('td', { title: row.target_url }, createElement('code', null, hostOf(row.target_url))),
    createElement('td', { 'data-metric-value': true }, String(row.attempt_count)),
    createElement('td', null, row.last_status === null ? EMPTY : String(row.last_status)),
    createElement(
      'td',
      { 'data-status': state.category, 'data-status-category': state.category },
      createElement('span', null, state.label),
      // The secret-free error is shown inline under a failed delivery so the operator can act.
      state.category === 'failed' && row.last_error !== null
        ? createElement('span', { 'data-delivery-error': true }, ` — ${row.last_error}`)
        : null,
    ),
    createElement(
      'td',
      null,
      createElement(
        'time',
        { dateTime: row.updated_at, title: formatTimestamp(row.updated_at) },
        relativeTime(row.updated_at),
      ),
    ),
  );
}

/** Best-effort host extraction for a compact target cell; falls back to the raw string. */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function outboundTable(rows: readonly OutboundDeliveryRow[]): ReactElement {
  return createElement(
    'table',
    null,
    createElement('caption', null, 'Outbound deliveries (artifact.approved)'),
    createElement(
      'thead',
      null,
      createElement(
        'tr',
        null,
        ...OUTBOUND_HEADERS.map((label) => createElement('th', { key: label, scope: 'col' }, label)),
      ),
    ),
    createElement(
      'tbody',
      null,
      rows.length === 0
        ? createElement(
            'tr',
            null,
            createElement(
              'td',
              { colSpan: OUTBOUND_HEADERS.length },
              'No outbound webhook deliveries yet. Approving an artifact dispatches one when a ' +
                'distribution webhook is configured.',
            ),
          )
        : rows.map(outboundRow),
    ),
  );
}

const INBOUND_HEADERS = ['Source', 'Delivery GUID', 'Received'];

function inboundTable(rows: readonly InboundDeliveryRow[]): ReactElement {
  return createElement(
    'table',
    null,
    createElement('caption', null, 'Inbound deliveries (deduped)'),
    createElement(
      'thead',
      null,
      createElement(
        'tr',
        null,
        ...INBOUND_HEADERS.map((label) => createElement('th', { key: label, scope: 'col' }, label)),
      ),
    ),
    createElement(
      'tbody',
      null,
      rows.length === 0
        ? createElement(
            'tr',
            null,
            createElement(
              'td',
              { colSpan: INBOUND_HEADERS.length },
              'No inbound webhook deliveries recorded yet.',
            ),
          )
        : rows.map((row) =>
            createElement(
              'tr',
              { key: row.delivery_guid },
              createElement('th', { scope: 'row' }, humanizeStatus(row.source)),
              createElement('td', null, createElement('code', null, row.delivery_guid)),
              createElement(
                'td',
                null,
                createElement(
                  'time',
                  { dateTime: row.received_at, title: formatTimestamp(row.received_at) },
                  relativeTime(row.received_at),
                ),
              ),
            ),
          ),
    ),
  );
}

export function WebhookDeliveries({
  outbound,
  inbound,
  totals,
}: WebhookDeliveriesProps): ReactElement {
  return createElement(
    'div',
    null,
    createElement(
      'section',
      { 'aria-labelledby': 'outbound-heading' },
      createElement('h2', { id: 'outbound-heading' }, 'Outbound deliveries'),
      summaryStrip(totals),
      outboundTable(outbound),
    ),
    createElement(
      'section',
      { 'aria-labelledby': 'inbound-heading' },
      createElement('h2', { id: 'inbound-heading' }, 'Inbound deliveries'),
      inboundTable(inbound),
    ),
  );
}
