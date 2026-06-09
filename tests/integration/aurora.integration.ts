// Integration: the dashboard's Postgres connection policy against a REAL TLS Postgres +
// pgvector. Proves the app's connection settings actually negotiate TLS (constitution:
// TLS is mandatory) and that the Alembic migrations installed pgvector — neither is
// exercisable by the in-memory unit suite.
//
// It drives the same `pg` driver the app uses and mirrors app/lib/aurora.ts's exact TLS
// mapping (PGSSLMODE != 'disable' → SSL on; chain verified only under 'verify-full').
// We connect with `pg` directly rather than importing aurora.ts because that module pulls
// in `server-only` and `pg` via named imports that Node's raw ESM loader can't bind — the
// connection under test is identical either way.
//
// Skips unless RUN_INTEGRATION=1 and DATABASE_URL is set; run via `npm run test:integration`.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
// pg is CommonJS; Node's raw ESM loader can't bind its named exports, so default-import.
import pg from 'pg';

const RUN = process.env.RUN_INTEGRATION === '1';
const DATABASE_URL = process.env.DATABASE_URL ?? '';
const READY = RUN && DATABASE_URL !== '';
const skip: string | false = READY
  ? false
  : RUN
    ? 'DATABASE_URL not set (bring up the local stack first)'
    : 'set RUN_INTEGRATION=1 (needs the local stack) to run integration tests';

/** The TLS policy app/lib/aurora.ts applies, replicated exactly. */
function sslConfig(): false | { rejectUnauthorized: boolean } {
  const mode = process.env.PGSSLMODE ?? 'require';
  if (mode === 'disable') return false;
  return { rejectUnauthorized: mode === 'verify-full' };
}

let client: pg.Client | null = null;
async function connect(): Promise<pg.Client> {
  const c = new pg.Client({ connectionString: DATABASE_URL, ssl: sslConfig() });
  await c.connect();
  return c;
}

after(async () => {
  if (client !== null) await client.end();
});

test('the app DB connection negotiates TLS (pg_stat_ssl)', { skip }, async () => {
  client ??= await connect();
  const r = await client.query<{ ssl: boolean }>(
    'SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()',
  );
  assert.equal(r.rows[0]?.ssl, true);
});

test('pgvector extension is installed (migrations applied)', { skip }, async () => {
  client ??= await connect();
  const r = await client.query("SELECT 1 AS ok FROM pg_extension WHERE extname = 'vector'");
  assert.equal(r.rowCount, 1);
});
