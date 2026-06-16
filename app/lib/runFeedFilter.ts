// Frontend audit — pure filter + pagination for the run feed. The feed previously rendered the
// full result set unbounded with no search or status filter. This holds the (DOM-free, server-only-
// free) logic so it is unit-testable under `node --test` and reusable by the client RunFeed wrapper.

import type { ReleaseRun } from '@/app/lib/db/releaseRuns.ts';
import { statusCategory, type StatusCategory } from './runProgress.ts';

/** The status filter options: the four reviewer-facing buckets plus 'all'. */
export type RunStatusFilter = 'all' | StatusCategory;

export const RUN_STATUS_FILTERS: ReadonlyArray<{ readonly value: RunStatusFilter; readonly label: string }> = [
  { value: 'all', label: 'All statuses' },
  { value: 'awaiting', label: 'Awaiting review' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'done', label: 'Done' },
  { value: 'failed', label: 'Failed' },
];

/** Case-insensitive substring match across the human-meaningful run fields (repo, compare range,
 *  and the full id so a pasted UUID still finds its run). */
function matchesQuery(run: ReleaseRun, needle: string): boolean {
  if (needle === '') return true;
  const haystack = `${run.repo} ${run.base_ref} ${run.head_ref} ${run.id}`.toLowerCase();
  return haystack.includes(needle);
}

export interface RunFilter {
  readonly query: string;
  readonly status: RunStatusFilter;
}

/** Filter runs by free-text query and status bucket. Order is preserved (caller's input order). */
export function filterRuns(runs: readonly ReleaseRun[], filter: RunFilter): readonly ReleaseRun[] {
  const needle = filter.query.trim().toLowerCase();
  return runs.filter(
    (run) =>
      matchesQuery(run, needle) &&
      (filter.status === 'all' || statusCategory(run.status) === filter.status),
  );
}

export interface Page<T> {
  readonly items: readonly T[];
  /** 1-based page actually returned (clamped into range). */
  readonly page: number;
  readonly pageCount: number;
  readonly total: number;
  readonly pageSize: number;
}

/** Slice `items` into a 1-based page. An out-of-range page clamps to the nearest valid page so a
 *  filter change that shrinks the result set can never strand the view on an empty page. */
export function paginate<T>(items: readonly T[], page: number, pageSize: number): Page<T> {
  const size = Math.max(1, Math.trunc(pageSize));
  const total = items.length;
  const pageCount = Math.max(1, Math.ceil(total / size));
  const clamped = Math.min(Math.max(1, Math.trunc(page)), pageCount);
  const start = (clamped - 1) * size;
  return {
    items: items.slice(start, start + size),
    page: clamped,
    pageCount,
    total,
    pageSize: size,
  };
}
