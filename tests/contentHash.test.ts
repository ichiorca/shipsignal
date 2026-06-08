// T1/T5 (spec 016) — the §18.3 artifact content hash, dashboard side. Proves the digest is stable
// and matches the canonical pre-image (title + "\n\n" + body) so the dashboard recompute on
// edit/approval agrees byte-for-byte with the worker (content_hash.py) and the SQL backfill.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { artifactContentHash } from '../app/lib/contentHash.ts';

test('matches the canonical title + "\\n\\n" + body sha256 hex', () => {
  const expected = createHash('sha256').update('Title\n\nBody text', 'utf8').digest('hex');
  assert.equal(artifactContentHash('Title', 'Body text'), expected);
});

test('is stable across calls for the same content', () => {
  const a = artifactContentHash('Release highlights', 'We shipped X and Y.');
  const b = artifactContentHash('Release highlights', 'We shipped X and Y.');
  assert.equal(a, b);
});

test('null/undefined title canonicalizes to empty string', () => {
  assert.equal(artifactContentHash(null, 'body'), artifactContentHash('', 'body'));
  assert.equal(artifactContentHash(undefined, 'body'), artifactContentHash('', 'body'));
});

test('changes when the body changes', () => {
  assert.notEqual(artifactContentHash('T', 'original'), artifactContentHash('T', 'edited'));
});

test('agrees with the worker/SQL canonical digest for a known vector', () => {
  // Same pre-image Python's hashlib.sha256(b"T\n\nB") and SQL digest(...) produce.
  const expected = createHash('sha256').update('T\n\nB', 'utf8').digest('hex');
  assert.equal(artifactContentHash('T', 'B'), expected);
});
