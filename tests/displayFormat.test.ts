// Unit coverage for the shared display formatters (UX review H2/L2): human-readable
// statuses, snake_case keys, and UTC timestamps — with graceful fallbacks.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY, humanizeStatus, humanizeKey, formatTimestamp } from '../app/lib/displayFormat.ts';

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
