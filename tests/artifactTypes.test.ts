// T2/T5 (spec 022) — AC: ARTIFACT_TYPES_DEFAULT (the webhook-run default selection) is
// validated at startup. Exercises the same pure parser the server-only default module
// evaluates at module load, plus the §8.1 type guard the boundaries share.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALL_ARTIFACT_TYPES,
  isArtifactType,
  parseArtifactTypesDefault,
} from '../app/lib/artifactTypes.ts';

test('unset or blank env yields all six §8.1 types', () => {
  assert.deepEqual(parseArtifactTypesDefault(undefined), ALL_ARTIFACT_TYPES);
  assert.deepEqual(parseArtifactTypesDefault(''), ALL_ARTIFACT_TYPES);
  assert.deepEqual(parseArtifactTypesDefault('   '), ALL_ARTIFACT_TYPES);
});

test('a comma-separated subset parses, tolerating whitespace', () => {
  assert.deepEqual(parseArtifactTypesDefault('changelog_entry, linkedin_post'), [
    'changelog_entry',
    'linkedin_post',
  ]);
});

test('an unknown type throws at parse (startup) time, naming the allowed set', () => {
  assert.throws(
    () => parseArtifactTypesDefault('changelog_entry,not_a_type'),
    /unknown artifact type.*not_a_type|not_a_type.*expected/s,
  );
});

test('a duplicated type throws', () => {
  assert.throws(
    () => parseArtifactTypesDefault('changelog_entry,changelog_entry'),
    /more than once/,
  );
});

test('a dangling comma (empty entry) throws rather than passing silently', () => {
  assert.throws(() => parseArtifactTypesDefault('changelog_entry,'));
});

test('isArtifactType narrows exactly the §8.1 set', () => {
  for (const type of ALL_ARTIFACT_TYPES) {
    assert.equal(isArtifactType(type), true);
  }
  assert.equal(isArtifactType('full_training_video'), false); // §8.2 deferred
  assert.equal(isArtifactType(''), false);
});
