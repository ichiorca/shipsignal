// T3/T4 (spec 015) — AC: the GET read APIs do real work and return typed data. These
// tests exercise the resolution logic the route handlers run (the routes are 2-line
// adapters over these helpers), with fake loaders so no DB is needed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ok, notFound, resolveOne, resolveScopedList } from '../app/lib/readApi.ts';

test('ok/notFound build the right status + body envelope', () => {
  assert.deepEqual(ok({ run: 1 }), { status: 200, body: { run: 1 } });
  assert.deepEqual(notFound('release run not found'), {
    status: 404,
    body: { error: 'release run not found' },
  });
});

test('resolveOne returns 200 with the shaped body when the resource exists', async () => {
  const result = await resolveOne(
    async () => ({ id: 'r1', repo: 'org/p' }),
    'release run not found',
    (run) => ({ run }),
  );
  assert.deepEqual(result, { status: 200, body: { run: { id: 'r1', repo: 'org/p' } } });
});

test('resolveOne returns 404 when the loader yields null', async () => {
  const result = await resolveOne(
    async () => null,
    'artifact not found',
    (a) => ({ artifact: a }),
  );
  assert.deepEqual(result, { status: 404, body: { error: 'artifact not found' } });
});

test('resolveScopedList 404s when the parent is missing and never loads the list', async () => {
  let listLoaded = false;
  const result = await resolveScopedList(
    async () => null,
    'release run not found',
    async () => {
      listLoaded = true;
      return [];
    },
    (features) => ({ features }),
  );
  assert.deepEqual(result, { status: 404, body: { error: 'release run not found' } });
  assert.equal(listLoaded, false, 'the list query is skipped on the 404 path');
});

test('resolveScopedList returns 200 with the (possibly empty) list when the parent exists', async () => {
  const present = await resolveScopedList(
    async () => ({ id: 'r1' }),
    'release run not found',
    async () => [{ id: 'f1' }, { id: 'f2' }],
    (features) => ({ features }),
  );
  assert.deepEqual(present, { status: 200, body: { features: [{ id: 'f1' }, { id: 'f2' }] } });

  const empty = await resolveScopedList(
    async () => ({ id: 'r1' }),
    'release run not found',
    async () => [],
    (artifacts) => ({ artifacts }),
  );
  assert.deepEqual(empty, { status: 200, body: { artifacts: [] } });
});
