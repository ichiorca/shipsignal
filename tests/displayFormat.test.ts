// Unit coverage for the shared display formatters (UX review H2/L2): human-readable
// statuses, snake_case keys, and UTC timestamps — with graceful fallbacks.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EMPTY,
  humanizeStatus,
  humanizeKey,
  formatTimestamp,
  relativeTime,
} from '../app/lib/displayFormat.ts';

test('humanizeStatus turns snake_case enums into a capitalized phrase', () => {
  assert.equal(humanizeStatus('pending_review'), 'Pending review');
  assert.equal(humanizeStatus('release_audio_digest'), 'Release audio digest');
  assert.equal(humanizeStatus('completed'), 'Completed');
});

test('humanizeStatus returns the empty placeholder for a blank value', () => {
  assert.equal(humanizeStatus('   '), EMPTY);
});

test('humanizeKey humanizes provenance keys', () => {
  assert.equal(humanizeKey('clickpath_hash'), 'Clickpath hash');
  assert.equal(humanizeKey('voice_id'), 'Voice id');
});

test('formatTimestamp renders an ISO string as a UTC date', () => {
  const out = formatTimestamp('2026-06-08T12:00:00.000Z');
  assert.match(out, /2026/);
  assert.match(out, /UTC$/);
  // The raw ISO must not leak through as the visible label.
  assert.ok(!out.includes('T12:00'));
});

test('formatTimestamp returns the original string when it is not a date', () => {
  assert.equal(formatTimestamp('not-a-date'), 'not-a-date');
});

test('relativeTime renders compact, scannable ages against an injected now', () => {
  const now = new Date('2026-06-15T12:00:00.000Z');
  assert.equal(relativeTime('2026-06-15T11:59:50.000Z', now), 'just now');
  assert.equal(relativeTime('2026-06-15T11:55:00.000Z', now), '5m ago');
  assert.equal(relativeTime('2026-06-15T09:00:00.000Z', now), '3h ago');
  assert.equal(relativeTime('2026-06-13T12:00:00.000Z', now), '2d ago');
  // Older than ~30d falls back to a short absolute date (no "45d ago").
  assert.match(relativeTime('2026-01-01T12:00:00.000Z', now), /Jan 1/);
});

test('relativeTime degrades gracefully and never shows a future negative', () => {
  const now = new Date('2026-06-15T12:00:00.000Z');
  assert.equal(relativeTime('2026-06-15T12:05:00.000Z', now), 'just now'); // clock skew
  assert.equal(relativeTime('not-a-date', now), 'not-a-date');
});
