// T1 (spec 001) — server-only Aurora PostgreSQL client.
// aurora-postgresql-rules + P1/P4: TLS is mandatory; creds come from env (IAM in
// prod); short-lived serverless/route contexts must NOT open a raw per-invocation
// pool to the cluster — they go through a pooled/RDS-Proxy endpoint. We hold one
// lazily-initialised module-scoped pool per server runtime and reuse it.

import 'server-only';
import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { requireEnv, optionalEnv } from '@/app/lib/env.ts';

let pool: Pool | undefined;

interface SslConfig {
  readonly rejectUnauthorized: boolean;
  readonly ca?: string;
}

function sslConfig(): SslConfig | false {
  // TLS is mandatory. Verification policy, strongest-first:
  //   1. PGSSLROOTCERT set  → verify the server cert against that CA bundle (set this to the
  //      Amazon RDS CA PEM in prod). This is the only mode that defeats a MITM with a forged
  //      cert, so it is the recommended production setting.
  //   2. PGSSLMODE=verify-full (no CA) → verify against the system trust store.
  //   3. PGSSLMODE=require (default) → encrypt but DON'T verify the chain. Acceptable only for
  //      a trusted-network endpoint (RDS Proxy in-VPC) or a self-signed local dev cert; we warn
  //      so the weaker posture is visible in logs. Prefer PGSSLROOTCERT in production.
  //   4. PGSSLMODE=disable → rejected (TLS is mandatory).
  const mode = optionalEnv('PGSSLMODE', 'require');
  if (mode === 'disable') {
    throw new Error('PGSSLMODE=disable is forbidden: TLS to Aurora is mandatory');
  }
  const caPath = optionalEnv('PGSSLROOTCERT', '');
  if (caPath !== '') {
    return { ca: readFileSync(caPath, 'utf8'), rejectUnauthorized: true };
  }
  if (mode === 'verify-full') {
    return { rejectUnauthorized: true };
  }
  // require, no CA → encrypted but unverified (MITM-able). Forbidden in production: fail closed
  // rather than silently shipping an unverified DB connection. Dev/local (self-signed) warns.
  if (optionalEnv('NODE_ENV', '') === 'production') {
    throw new Error(
      'PGSSLMODE=require without PGSSLROOTCERT is forbidden in production: refusing an ' +
        'unverified TLS connection to Aurora. Set PGSSLROOTCERT to the RDS CA bundle, or ' +
        'PGSSLMODE=verify-full.',
    );
  }
  console.warn(
    'PGSSLMODE=require without PGSSLROOTCERT: the Aurora TLS connection is encrypted but the ' +
      'server certificate is NOT verified. Set PGSSLROOTCERT to the RDS CA bundle in production.',
  );
  return { rejectUnauthorized: false };
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

/** Minimal query surface shared by the pool and a transaction client, so repository
 * helpers can run either standalone (pool, autocommit) or inside `withTransaction`. Both
 * `Pool` and `PoolClient` satisfy it. */
export interface Queryable {
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<QueryResult<R>>;
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
    // Don't let a failed ROLLBACK (e.g. a broken connection) mask the original error.
    try {
      await client.query('ROLLBACK');
    } catch {
      /* keep the original error */
    }
    throw err;
  } finally {
    client.release();
  }
}
