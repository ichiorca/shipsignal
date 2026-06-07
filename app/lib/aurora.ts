// T1 (spec 001) — server-only Aurora PostgreSQL client.
// aurora-postgresql-rules + P1/P4: TLS is mandatory; creds come from env (IAM in
// prod); short-lived serverless/route contexts must NOT open a raw per-invocation
// pool to the cluster — they go through a pooled/RDS-Proxy endpoint. We hold one
// lazily-initialised module-scoped pool per server runtime and reuse it.

import 'server-only';
import { Pool } from 'pg';
import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { requireEnv, optionalEnv } from '@/app/lib/env.ts';

let pool: Pool | undefined;

function sslConfig(): { rejectUnauthorized: boolean } | false {
  // TLS is mandatory. `require` trusts the chain at the transport layer; `verify-full`
  // (recommended for prod against the RDS CA bundle) additionally pins the host.
  const mode = optionalEnv('PGSSLMODE', 'require');
  if (mode === 'disable') {
    throw new Error('PGSSLMODE=disable is forbidden: TLS to Aurora is mandatory');
  }
  return { rejectUnauthorized: mode === 'verify-full' };
}

/** The lazily-created, reused connection pool. One per server runtime. */
export function getPool(): Pool {
  if (pool === undefined) {
    pool = new Pool({
      connectionString: requireEnv('DATABASE_URL'),
      ssl: sslConfig(),
      // Keep the per-runtime pool small: in serverless/Actions contexts many runtimes
      // multiply this, and the real fan-in cap belongs to RDS Proxy / the pooled
      // endpoint, not here.
      max: 5,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 5_000,
    });
  }
  return pool;
}

/** Run a parameterised query on the pool. Always use $1/$2 placeholders — never
 * string-concatenate untrusted values into SQL. */
export function query<R extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: readonly unknown[],
): Promise<QueryResult<R>> {
  return getPool().query<R>(text, params as unknown[] | undefined);
}

/** Run `fn` inside a single transaction, releasing the client on every path. */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
