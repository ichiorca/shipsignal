// T1/T2 (spec 001) — release_runs repository: typed reads/writes over the table
// defined in db/migrations/versions/0001_release_runs.py (PRD §10.1).
// P4 (Storage): every row is keyed by its own `id`, which is the release_run_id the
// whole pipeline references downstream. All queries are parameterised.

import { randomUUID } from 'node:crypto';
import { query, type Queryable } from '@/app/lib/aurora.ts';
import { isUuid } from '@/app/lib/uuid.ts';
import type { RunStatus } from '@/app/lib/runStatus.ts';
import { isRunStatus } from '@/app/lib/runStatus.ts';
import { isArtifactType, ALL_ARTIFACT_TYPES, type ArtifactType } from '@/app/lib/artifactTypes.ts';

export type TriggerType = 'manual' | 'release_tag' | 'workflow_dispatch';

/** A release_runs row as the dashboard/API consume it (snake_case mirrors columns). */
export interface ReleaseRun {
  readonly id: string;
  readonly repo: string;
  readonly base_ref: string;
  readonly head_ref: string;
  readonly trigger_type: TriggerType;
  readonly status: RunStatus;
  /** T1 (spec 022) — the §8.1 types this run generates; immutable after creation. */
  readonly artifact_types: readonly ArtifactType[];
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
  artifact_types: string[];
  langgraph_thread_id: string | null;
  started_at: Date | string;
  completed_at: Date | string | null;
}

function toIso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function mapArtifactTypes(values: string[]): readonly ArtifactType[] {
  // The DB CHECK already pins the value space; re-narrow here so the row type is honest
  // and schema drift (e.g. a future type added in only one layer) surfaces loudly.
  const types = values.filter(isArtifactType);
  if (types.length !== values.length || types.length === 0) {
    throw new Error(`unexpected artifact_types in DB: ${values.join(', ')}`);
  }
  return types;
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
    artifact_types: mapArtifactTypes(row.artifact_types),
    langgraph_thread_id: row.langgraph_thread_id,
    started_at: toIso(row.started_at) ?? '',
    completed_at: toIso(row.completed_at),
  };
}

const SELECT_COLUMNS =
  'id, repo, base_ref, head_ref, trigger_type, status, artifact_types, langgraph_thread_id, started_at, completed_at';

export interface CreateReleaseRunArgs {
  readonly repo: string;
  readonly base_ref: string;
  readonly head_ref: string;
  readonly trigger_type: TriggerType;
  /** T1 (spec 022) — the run's selection; omitted → the DB DEFAULT (all six §8.1 types). */
  readonly artifact_types?: readonly ArtifactType[];
  /** Optional saved-project association (migration 0030); null/omitted → an ad-hoc run. */
  readonly project_id?: string;
  readonly run_metadata?: Readonly<Record<string, unknown>>;
}

/** Insert a new run in `created` status (PRD §13.2 initial state); returns the created
 *  row (incl. generated id). The worker advances it through the lifecycle from here. */
export async function insertReleaseRun(
  args: CreateReleaseRunArgs,
  db: Queryable = { query },
): Promise<ReleaseRun> {
  const id = randomUUID();
  // artifact_types: a selection-less insert defaults to "generate everything" (the pre-022
  // behaviour). The default is derived from ALL_ARTIFACT_TYPES — the one source of truth — rather
  // than a hardcoded SQL literal, so it can never drift out of sync when the type set grows.
  const artifactTypes = args.artifact_types
    ? [...args.artifact_types]
    : [...ALL_ARTIFACT_TYPES];
  const result = await db.query<ReleaseRunRow>(
    `INSERT INTO release_runs
       (id, repo, base_ref, head_ref, trigger_type, status, artifact_types, project_id, run_metadata_json)
     VALUES ($1, $2, $3, $4, $5, 'created', $6::text[], $7, $8)
     RETURNING ${SELECT_COLUMNS}`,
    [
      id,
      args.repo,
      args.base_ref,
      args.head_ref,
      args.trigger_type,
      artifactTypes,
      args.project_id ?? null,
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
