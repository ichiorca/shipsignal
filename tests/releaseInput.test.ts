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

// --- T1/T5 (spec 022) — per-run artifact-type selection boundaries -----------------

const BASE_BODY = { repo: 'org/product', base_ref: 'v1.0.0', head_ref: 'v1.1.0' };

test('accepts a single-type selection', () => {
  const result = parseCreateReleaseRun({ ...BASE_BODY, artifact_types: ['changelog_entry'] });
  assert.equal(result.ok, true);
  assert.deepEqual(result.ok && result.value.artifact_types, ['changelog_entry']);
});

test('accepts the full §8.1 selection', () => {
  const all = [
    'release_blog',
    'changelog_entry',
    'sales_onepager',
    'linkedin_post',
    'demo_script',
    'release_audio_digest',
    'customer_email',
    'battlecard_delta',
  ];
  const result = parseCreateReleaseRun({ ...BASE_BODY, artifact_types: all });
  assert.equal(result.ok, true);
  assert.deepEqual(result.ok && result.value.artifact_types, all);
});

test('omitted artifact_types parses ok (the route applies the default set)', () => {
  const result = parseCreateReleaseRun(BASE_BODY);
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.value.artifact_types, undefined);
});

test('rejects an empty artifact_types array with a user-safe message', () => {
  const result = parseCreateReleaseRun({ ...BASE_BODY, artifact_types: [] });
  assert.equal(result.ok, false);
  assert.ok(
    result.ok === false &&
      result.errors.some((e) => e.includes('at least one artifact type')),
  );
});

test('rejects an unknown artifact type, naming the allowed set', () => {
  const result = parseCreateReleaseRun({
    ...BASE_BODY,
    artifact_types: ['release_blog', 'full_training_video'],
  });
  assert.equal(result.ok, false);
  assert.ok(
    result.ok === false && result.errors.some((e) => e.includes('unknown artifact type')),
  );
});

test('rejects duplicate artifact types', () => {
  const result = parseCreateReleaseRun({
    ...BASE_BODY,
    artifact_types: ['release_blog', 'release_blog'],
  });
  assert.equal(result.ok, false);
  assert.ok(result.ok === false && result.errors.some((e) => e.includes('must not repeat')));
});
