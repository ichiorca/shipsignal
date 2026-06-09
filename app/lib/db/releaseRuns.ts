// T1/T2 (spec 001) — release_runs repository: typed reads/writes over the table
// defined in db/migrations/versions/0001_release_runs.py (PRD §10.1).
// P4 (Storage): every row is keyed by its own `id`, which is the release_run_id the
// whole pipeline references downstream. All queries are parameterised.

import { randomUUID } from 'node:crypto';
import { query, type Queryable } from '@/app/lib/aurora.ts';
import { isUuid } from '@/app/lib/uuid.ts';
import type { RunStatus } from '@/app/lib/runStatus.ts';
import { isRunStatus } from '@/app/lib/runStatus.ts';

export type TriggerType = 'manual' | 'release_tag' | 'workflow_dispatch';

/** A release_runs row as the dashboard/API consume it (snake_case mirrors columns). */
export interface ReleaseRun {
  readonly id: string;
  readonly repo: string;
  readonly base_ref: string;
  readonly head_ref: string;
  readonly trigger_type: TriggerType;
  readonly status: RunStatus;
  readonly langgraph_thread_id: string | null;
  readonly started_at: string;
  readonly completed_at: string | null;
}

interface ReleaseRunRow {
  id: string;
  repo: string;
  base_ref: string;
  head_ref: string;
  trigger_type: string;
  status: string;
  langgraph_thread_id: string | null;
  started_at: Date | string;
  completed_at: Date | string | null;
}

function toIso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function mapRow(row: ReleaseRunRow): ReleaseRun {
  if (!isRunStatus(row.status)) {
    // The DB is the source of truth; an unrecognised status means schema drift, which
    // we surface loudly rather than rendering a bogus state.
    throw new Error(`unexpected run status in DB: ${row.status}`);
  }
  return {
    id: row.id,
    repo: row.repo,
    base_ref: row.base_ref,
    head_ref: row.head_ref,
    trigger_type: row.trigger_type as TriggerType,
    status: row.status,
    langgraph_thread_id: row.langgraph_thread_id,
    started_at: toIso(row.started_at) ?? '',
    completed_at: toIso(row.completed_at),
  };
}

const SELECT_COLUMNS =
  'id, repo, base_ref, head_ref, trigger_type, status, langgraph_thread_id, started_at, completed_at';

export interface CreateReleaseRunArgs {
  readonly repo: string;
  readonly base_ref: string;
  readonly head_ref: string;
  readonly trigger_type: TriggerType;
  readonly run_metadata?: Readonly<Record<string, unknown>>;
}

/** Insert a new run in `created` status (PRD §13.2 initial state); returns the created
 *  row (incl. generated id). The worker advances it through the lifecycle from here. */
export async function insertReleaseRun(
  args: CreateReleaseRunArgs,
  db: Queryable = { query },
): Promise<ReleaseRun> {
  const id = randomUUID();
  const result = await db.query<ReleaseRunRow>(
    `INSERT INTO release_runs
       (id, repo, base_ref, head_ref, trigger_type, status, run_metadata_json)
     VALUES ($1, $2, $3, $4, $5, 'created', $6)
     RETURNING ${SELECT_COLUMNS}`,
    [
      id,
      args.repo,
      args.base_ref,
      args.head_ref,
      args.trigger_type,
      JSON.stringify(args.run_metadata ?? {}),
    ],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error('insert release_run returned no row');
  }
  return mapRow(row);
}

/** List runs newest-first for the dashboard feed. */
export async function listReleaseRuns(limit = 50): Promise<readonly ReleaseRun[]> {
  const result = await query<ReleaseRunRow>(
    `SELECT ${SELECT_COLUMNS} FROM release_runs ORDER BY started_at DESC LIMIT $1`,
    [limit],
  );
  return result.rows.map(mapRow);
}

/** Fetch one run by id, or null if it does not exist. */
export async function getReleaseRun(id: string): Promise<ReleaseRun | null> {
  // A malformed id is "no such run" (404), not a 500 from the uuid column rejecting it.
  if (!isUuid(id)) return null;
  const result = await query<ReleaseRunRow>(
    `SELECT ${SELECT_COLUMNS} FROM release_runs WHERE id = $1`,
    [id],
  );
  return result.rows[0] ? mapRow(result.rows[0]) : null;
}
