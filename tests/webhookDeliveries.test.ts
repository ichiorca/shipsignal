// T4 (spec 001) follow-up — the inbound-webhook dedupe key is COMPOSITE
// (source, delivery_guid), not delivery_guid alone, so a second provider whose id space
// collides with GitHub's is not silently dropped as a replay.
//
// AuroraDeliveryGuidStore lives in a server-only module (it imports app/lib/aurora.ts,
// which does `import 'server-only'` and opens a pg pool) and so cannot be imported under
// the project's strip-only `node --test` runner — db modules are only ever type-imported
// in unit tests here. We therefore assert the dedupe CONTRACT at its two durable surfaces:
// the store's INSERT ... ON CONFLICT target and the migration that re-keys the table.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const storeSql = readFileSync(`${repoRoot}app/lib/db/webhookDeliveries.ts`, 'utf8');
const migration = readFileSync(
  `${repoRoot}db/migrations/versions/0039_webhook_deliveries_composite_key.py`,
  'utf8',
);

test('markIfNew inserts the source column alongside the delivery GUID', () => {
  assert.match(storeSql, /INSERT INTO webhook_deliveries \(delivery_guid, source\)/);
  // Both bind params are passed, so source is never defaulted away.
  assert.match(storeSql, /\[deliveryGuid, this\.source\]/);
});

test('markIfNew dedupes on the composite (source, delivery_guid) key, not the GUID alone', () => {
  assert.match(storeSql, /ON CONFLICT \(source, delivery_guid\) DO NOTHING/);
  assert.doesNotMatch(
    storeSql,
    /ON CONFLICT \(delivery_guid\) DO NOTHING/,
    'must not regress to the guid-only conflict target',
  );
});

test('migration 0039 chains off the prior head and re-keys to the composite PRIMARY KEY', () => {
  assert.match(migration, /revision: str = "0039_webhook_deliveries_composite_key"/);
  assert.match(migration, /down_revision: str \| None = "0038_connections"/);
  // upgrade swaps the guid-only PK for the composite one; downgrade restores it.
  assert.match(migration, /PRIMARY KEY \(source, delivery_guid\)/);
  assert.match(migration, /DROP CONSTRAINT IF EXISTS webhook_deliveries_pkey/);
  assert.match(migration, /PRIMARY KEY \(delivery_guid\)/); // downgrade path
});
