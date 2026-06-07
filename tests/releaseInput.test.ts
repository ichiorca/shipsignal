// T3 (spec 001) — AC: creating a manual run validates {repo, base_ref, head_ref}.
// Exercises the same validator the POST /api/releases handler calls.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCreateReleaseRun } from '../app/lib/releaseInput.ts';

test('accepts a well-formed compare-range body', () => {
  const result = parseCreateReleaseRun({
    repo: 'org/product',
    base_ref: 'v1.12.0',
    head_ref: 'v1.13.0',
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.ok && result.value, {
    repo: 'org/product',
    base_ref: 'v1.12.0',
    head_ref: 'v1.13.0',
  });
});

test('rejects a repo that is not owner/repo', () => {
  const result = parseCreateReleaseRun({ repo: 'product', base_ref: 'a', head_ref: 'b' });
  assert.equal(result.ok, false);
  assert.ok(result.ok === false && result.errors.some((e) => e.includes('repo')));
});

test('rejects refs containing shell/ref metacharacters', () => {
  const result = parseCreateReleaseRun({
    repo: 'org/product',
    base_ref: 'v1..0',
    head_ref: 'main; rm -rf',
  });
  assert.equal(result.ok, false);
});

test('rejects missing fields', () => {
  const result = parseCreateReleaseRun({ repo: 'org/product' });
  assert.equal(result.ok, false);
});

test('rejects unknown keys (strict schema)', () => {
  const result = parseCreateReleaseRun({
    repo: 'org/product',
    base_ref: 'a',
    head_ref: 'b',
    is_admin: true,
  });
  assert.equal(result.ok, false);
});

test('rejects a non-object body', () => {
  assert.equal(parseCreateReleaseRun('nope').ok, false);
  assert.equal(parseCreateReleaseRun(null).ok, false);
});
