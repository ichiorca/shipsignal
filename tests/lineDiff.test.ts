// UI tier-2 #6 — the pure line-diff that drives the Gate #3 SKILL.md change highlighting.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lineDiff, hasChanges } from '../app/lib/lineDiff.ts';

test('identical bodies yield only unchanged lines', () => {
  const diff = lineDiff('a\nb\nc', 'a\nb\nc');
  assert.deepEqual(
    diff.map((l) => l.kind),
    ['same', 'same', 'same'],
  );
  assert.equal(hasChanges(diff), false);
});

test('a changed middle line shows as a delete then an add, framing lines unchanged', () => {
  const diff = lineDiff('keep\nold\ntail', 'keep\nnew\ntail');
  assert.deepEqual(diff, [
    { kind: 'same', text: 'keep' },
    { kind: 'del', text: 'old' },
    { kind: 'add', text: 'new' },
    { kind: 'same', text: 'tail' },
  ]);
  assert.equal(hasChanges(diff), true);
});

test('pure insertions and deletions are classified, not mislabeled as changes', () => {
  assert.deepEqual(
    lineDiff('a\nc', 'a\nb\nc').map((l) => `${l.kind}:${l.text}`),
    ['same:a', 'add:b', 'same:c'],
  );
  assert.deepEqual(
    lineDiff('a\nb\nc', 'a\nc').map((l) => `${l.kind}:${l.text}`),
    ['same:a', 'del:b', 'same:c'],
  );
});

test('an empty body is zero lines, not one blank line (no spurious diff row)', () => {
  assert.deepEqual(lineDiff('', '').length, 0);
  assert.deepEqual(
    lineDiff('', 'hello').map((l) => l.kind),
    ['add'],
  );
});
