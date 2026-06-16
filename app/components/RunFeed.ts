// Frontend audit — interactive run-feed wrapper. The feed was an unbounded, unfilterable table;
// this adds a free-text search, a status-bucket filter, and pagination around the existing
// presentational RunListTable (which keeps owning the semantic table + awaiting-first ordering).
//
// P6 (WCAG 2.2 AA): the controls are a real <form role="search"> with associated <label>s; a
// polite live region announces the result count after each filter/search/page change; pagination
// is real <button>s with aria-labels and a disabled state at the ends; the table itself is the
// already-accessible RunListTable. "use client": interactive leaf (ux-react) — it owns only view
// state (query / status / page); no data fetching or secret lives here (the page passes runs in).
//
// Authored with React.createElement (not JSX) so it renders under the dependency-free
// `node --test` a11y harness, mirroring the other components.

'use client';

import { createElement, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import type { ReleaseRun } from '@/app/lib/db/releaseRuns.ts';
import { RunListTable } from './RunListTable.ts';
import {
  filterRuns,
  paginate,
  RUN_STATUS_FILTERS,
  type RunStatusFilter,
} from '../lib/runFeedFilter.ts';

export interface RunFeedProps {
  readonly runs: readonly ReleaseRun[];
  /** Rows per page. Defaults to 20. */
  readonly pageSize?: number;
}

function controls(
  query: string,
  setQuery: (v: string) => void,
  status: RunStatusFilter,
  setStatus: (v: RunStatusFilter) => void,
): ReactElement {
  return createElement(
    'form',
    { role: 'search', 'data-run-filters': true, onSubmit: (e: { preventDefault: () => void }) => e.preventDefault() },
    createElement(
      'div',
      null,
      createElement('label', { htmlFor: 'run-search' }, 'Search runs'),
      createElement('input', {
        id: 'run-search',
        type: 'text',
        value: query,
        placeholder: 'repo, ref, or id',
        onChange: (e: { target: { value: string } }) => setQuery(e.target.value),
      }),
    ),
    createElement(
      'div',
      null,
      createElement('label', { htmlFor: 'run-status-filter' }, 'Filter by status'),
      createElement(
        'select',
        {
          id: 'run-status-filter',
          value: status,
          onChange: (e: { target: { value: string } }) => setStatus(e.target.value as RunStatusFilter),
        },
        ...RUN_STATUS_FILTERS.map((opt) =>
          createElement('option', { key: opt.value, value: opt.value }, opt.label),
        ),
      ),
    ),
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
    { 'aria-label': 'Run feed pagination', 'data-run-paginator': true },
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

export function RunFeed({ runs, pageSize = 20 }: RunFeedProps): ReactElement {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<RunStatusFilter>('all');
  const [page, setPage] = useState(1);
  // All hooks run unconditionally before any early return (rules of hooks). Recompute the filtered
  // set when inputs change; `paginate` clamps an over-range page so a shrinking result set is safe.
  const filtered = useMemo(() => filterRuns(runs, { query, status }), [runs, query, status]);

  // No runs at all: skip the filter chrome and let RunListTable own the "create your first run"
  // empty state, so we don't show pointless controls + a misleading "no runs match" message.
  if (runs.length === 0) {
    return createElement('div', { 'data-run-feed': true }, createElement(RunListTable, { runs }));
  }

  const pageView = paginate(filtered, page, pageSize);

  const countText =
    pageView.total === 0
      ? 'No runs match your filters.'
      : `Showing ${pageView.items.length} of ${pageView.total} ` +
        `${pageView.total === 1 ? 'run' : 'runs'}` +
        (pageView.pageCount > 1 ? ` (page ${pageView.page} of ${pageView.pageCount})` : '');

  return createElement(
    'div',
    { 'data-run-feed': true },
    controls(
      query,
      (v) => {
        setQuery(v);
        setPage(1);
      },
      status,
      (v) => {
        setStatus(v);
        setPage(1);
      },
    ),
    createElement('p', { role: 'status', 'aria-live': 'polite', 'data-run-count': true }, countText),
    createElement(RunListTable, { runs: pageView.items }),
    paginator(pageView.page, pageView.pageCount, setPage),
  );
}
