// T5 (spec 002) — presentational evidence table for the run-detail page.
// P6 (Quality bars / WCAG 2.2 AA): semantic <table> with <caption> and column
// <th scope="col">; risk flags rendered as text (not colour alone); the full-excerpt
// link points at the presigned-access route, never at the S3 URI. constitution §4/§5:
// only redacted content is rendered — the component is typed against `EvidenceItem`,
// which by construction carries no raw excerpt and no S3 URI.
//
// Authored with React.createElement (not JSX) so it renders under the dependency-free
// `node --test` harness, mirroring RunListTable.

import { createElement } from 'react';
import type { ReactElement } from 'react';
import type { EvidenceItem } from '@/app/lib/db/evidenceItems.ts';
import { EMPTY } from '../lib/displayFormat.ts';

export interface EvidenceTableProps {
  readonly items: readonly EvidenceItem[];
}

const HEADERS = ['File', 'Type', 'Source', 'Redacted excerpt', 'Risk flags', 'Full excerpt'];

function truncate(text: string, max = 160): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}

/** Redacted-excerpt cell: shows a one-line truncation, and when shortened exposes the full
 *  (still redacted) text via the native title tooltip so a reviewer isn't forced to the raw
 *  S3 blob just to read it (UX review M2). */
function excerptCell(text: string): ReactElement {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  const shown = truncate(text);
  return createElement('td', shown !== oneLine ? { title: oneLine } : null, shown);
}

function riskCell(flags: readonly string[]): ReactElement {
  if (flags.length === 0) {
    return createElement('td', { 'data-risk': 'none' }, createElement('span', null, 'none'));
  }
  // Text conveys the meaning; data-attribute lets CSS add colour as enhancement only.
  return createElement(
    'td',
    { 'data-risk': 'flagged' },
    createElement('span', null, flags.join(', ')),
  );
}

function sourceCell(item: EvidenceItem): ReactElement {
  if (item.source_url === null) {
    return createElement('td', null, item.source);
  }
  return createElement(
    'td',
    null,
    createElement('a', { href: item.source_url }, item.source),
  );
}

function fullExcerptCell(item: EvidenceItem): ReactElement {
  if (!item.has_raw_blob) {
    return createElement('td', null, EMPTY);
  }
  // Links to the presigned-access route, which 302s to a short-lived signed S3 URL.
  // The raw S3 URI is never placed in the markup. A per-row aria-label disambiguates the
  // otherwise-identical "View full excerpt" links for screen-reader link navigation, and
  // signals that this opens the raw (unredacted) evidence (UX review M1).
  return createElement(
    'td',
    null,
    createElement(
      'a',
      {
        href: `/api/evidence/${item.id}/raw`,
        'aria-label': `View raw full excerpt for ${item.file_path ?? 'this evidence item'}`,
      },
      'View full excerpt',
    ),
  );
}

function evidenceRow(item: EvidenceItem): ReactElement {
  return createElement(
    'tr',
    { key: item.id },
    // The file path is the row's header cell so screen readers announce it as context for
    // every other cell in the row (UX review L4).
    createElement('th', { scope: 'row' }, item.file_path ?? EMPTY),
    createElement('td', null, item.evidence_type),
    sourceCell(item),
    excerptCell(item.redacted_excerpt),
    riskCell(item.risk_flags),
    fullExcerptCell(item),
  );
}

function emptyState(): ReactElement {
  return createElement(
    'tr',
    null,
    createElement(
      'td',
      { colSpan: HEADERS.length },
      'No evidence collected for this run yet.',
    ),
  );
}

export function EvidenceTable({ items }: EvidenceTableProps): ReactElement {
  return createElement(
    'table',
    null,
    createElement('caption', null, 'Collected evidence (redacted)'),
    createElement(
      'thead',
      null,
      createElement(
        'tr',
        null,
        ...HEADERS.map((label) => createElement('th', { key: label, scope: 'col' }, label)),
      ),
    ),
    createElement(
      'tbody',
      null,
      items.length === 0 ? emptyState() : items.map(evidenceRow),
    ),
  );
}
