// Shared, pure display helpers so user-facing surfaces speak human language instead of
// raw enums / ISO strings / snake_case keys (UX review H2, L2). No 'server-only' import
// and no DOM access, so this is usable from both Server and Client Components and is
// unit-testable under the dependency-free `node --test` harness.

/** The single empty-value placeholder used across the dashboard (UX review L2). */
export const EMPTY = '—';

/**
 * Humanize a snake_case / lower-enum token into a capitalized phrase:
 *   'pending_review'        -> 'Pending review'
 *   'release_audio_digest'  -> 'Release audio digest'
 * Returns EMPTY for a blank value.
 */
export function humanizeStatus(value: string): string {
  const trimmed = value.trim();
  if (trimmed === '') return EMPTY;
  const words = trimmed.replace(/_/g, ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Humanize a snake_case key for display as a label: 'clickpath_hash' -> 'Clickpath hash'. */
export function humanizeKey(key: string): string {
  return humanizeStatus(key);
}

/**
 * Format an ISO-8601 timestamp for display in UTC, e.g. 'Jun 8, 2026, 12:00 UTC'.
 * Returns the original string unchanged if it is not a parseable date (never throws), so a
 * malformed value degrades gracefully instead of rendering 'Invalid Date'.
 */
export function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const formatted = new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  }).format(date);
  return `${formatted} UTC`;
}

/**
 * Compact relative time for scannable lists, e.g. 'just now', '5m ago', '3h ago', '2d ago',
 * 'Jun 8' for anything older than ~30 days. `now` is injectable so the output is deterministic
 * under test. Falls back to the raw string for an unparseable date (never throws).
 */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const seconds = Math.round((now.getTime() - date.getTime()) / 1000);
  if (seconds < 0) return 'just now'; // clock skew / future timestamp
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days <= 30) return `${days}d ago`;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}
