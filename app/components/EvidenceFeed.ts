// Frontend audit (gap #2) — interactive evidence-feed wrapper. The run-detail evidence list was an
// unbounded, unsearchable table; this adds a free-text search and pagination around the existing
// presentational EvidenceTable (which keeps owning the semantic table + redaction-safe rendering).
//
// P6 (WCAG 2.2 AA): the search is a real <form role="search"> with an associated <label>; a polite
// live region announces the result count after each search/page change; pagination is real
// <button>s with aria-labels and a disabled state at the ends. "use client": interactive leaf
// (ux-react) — it owns only view state (query / page); no data fetching or secret lives here (the
// page passes the redacted items in).
//
// Authored with React.createElement (not JSX) so it renders under the dependency-free
// `node --test` a11y harness, mirroring RunFeed.

'use client';

import { createElement, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import type { EvidenceItem } from '@/app/lib/db/evidenceItems.ts';
import { EvidenceTable } from './EvidenceTable.ts';
import { filterEvidence } from '../lib/evidenceFilter.ts';
import { paginate } from '../lib/runFeedFilter.ts';

export interface EvidenceFeedProps {
  readonly items: readonly EvidenceItem[];
  /** Rows per page. Defaults to 25. */
  readonly pageSize?: number;
}

function searchControls(query: string, setQuery: (v: string) => void): ReactElement {
  return createElement(
    'form',
    {
      role: 'search',
      'data-evidence-filters': true,
      onSubmit: (e: { preventDefault: () => void }) => e.preventDefault(),
    },
    createElement('label', { htmlFor: 'evidence-search' }, 'Search evidence'),
    createElement('input', {
      id: 'evidence-search',
      type: 'text',
      value: query,
      placeholder: 'file, type, symbol, or text',
      onChange: (e: { target: { value: string } }) => setQuery(e.target.value),
    }),
  );
}

function paginator(
  page: number,
  pageCount: number,
  setPage: (updater: (p: number) => number) => void,
): ReactElement | null {
  if (pageCount <= 1) return null;
  return createElement(
    'nav',
    { 'aria-label': 'Evidence pagination', 'data-evidence-paginator': true },
    createElement(
      'button',
      {
        type: 'button',
        'aria-label': 'Previous page',
        disabled: page <= 1,
        'data-secondary': true,
        onClick: () => setPage((p) => p - 1),
      },
      '← Previous',
    ),
    createElement('span', { 'data-page-status': true, 'aria-current': 'page' }, `Page ${page} of ${pageCount}`),
    createElement(
      'button',
      {
        type: 'button',
        'aria-label': 'Next page',
        disabled: page >= pageCount,
        'data-secondary': true,
        onClick: () => setPage((p) => p + 1),
      },
      'Next →',
    ),
  );
}

export function EvidenceFeed({ items, pageSize = 25 }: EvidenceFeedProps): ReactElement {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  // All hooks run unconditionally before any early return (rules of hooks).
  const filtered = useMemo(() => filterEvidence(items, query), [items, query]);

  // No evidence at all: let EvidenceTable own its empty state, skip the search chrome.
  if (items.length === 0) {
    return createElement('div', { 'data-evidence-feed': true }, createElement(EvidenceTable, { items }));
  }

  const pageView = paginate(filtered, page, pageSize);

  const countText =
    pageView.total === 0
      ? 'No evidence matches your search.'
      : `Showing ${pageView.items.length} of ${pageView.total} ` +
        `${pageView.total === 1 ? 'item' : 'items'}` +
        (pageView.pageCount > 1 ? ` (page ${pageView.page} of ${pageView.pageCount})` : '');

  return createElement(
    'div',
    { 'data-evidence-feed': true },
    searchControls(query, (v) => {
      setQuery(v);
      setPage(1);
    }),
    createElement('p', { role: 'status', 'aria-live': 'polite', 'data-evidence-count': true }, countText),
    createElement(EvidenceTable, { items: pageView.items }),
    paginator(pageView.page, pageView.pageCount, setPage),
  );
}
