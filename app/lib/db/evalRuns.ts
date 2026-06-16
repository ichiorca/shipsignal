// T5/T6 (spec 013) — eval_runs repository: typed reads of a run's evaluation results for the
// dashboard + read API (PRD §10.7 eval_runs, §17 metrics/rubric; migration 0012). P5 (Safety
// rails) + constitution §2/§5: every query is parameterised and scoped by release_run_id (the
// tenancy key — no cross-run bleed), and a row carries ONLY scores + aggregate counts (no prompt,
// evidence, or artifact body), so nothing sensitive reaches the browser or the API response.

import { query } from '@/app/lib/aurora.ts';
import { summarizeEvals } from '@/app/lib/evalMetrics.ts';
import type { EvalRunRow, RunEvalSummary } from '@/app/lib/evalMetrics.ts';
import {
  averageRubricDimensions,
  rubricOverall,
  type RubricDimensionAverage,
  type RubricMap,
} from '@/app/lib/rubricView.ts';

interface RawEvalRow {
  eval_type: string;
  // pg returns NUMERIC as a string; normalise to number | null below.
  score: string | number | null;
  findings_json: Record<string, unknown> | null;
  created_at: Date | string;
}

function asScore(value: string | number | null): number | null {
  return value === null ? null : Number(value);
}

function mapRow(row: RawEvalRow): EvalRunRow {
  return {
    eval_type: row.eval_type,
    score: asScore(row.score),
    findings: row.findings_json ?? {},
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  };
}

/** Raw eval rows for one run, newest first (so `summarizeEvals` keeps the latest per metric). */
export async function getRunEvalRows(releaseRunId: string): Promise<EvalRunRow[]> {
  const result = await query<RawEvalRow>(
    `SELECT eval_type, score, findings_json, created_at
       FROM eval_runs
      WHERE release_run_id = $1
      ORDER BY created_at DESC, eval_type ASC`,
    [releaseRunId],
  );
  return result.rows.map(mapRow);
}

/** The shaped per-run eval summary the dashboard renders (latest metric per type + rubric avg). */
export async function getRunEvalSummary(releaseRunId: string): Promise<RunEvalSummary> {
  return summarizeEvals(await getRunEvalRows(releaseRunId));
}

interface RubricJsonRow {
  // jsonb → pg returns a parsed object; defensively typed as unknown-valued.
  rubric_json: RubricMap | null;
}

/** Per-dimension rubric averages across a run's approved-artifact rubric rows (eval_type='rubric'),
 *  for the eval page's rubric chart. Each rubric row stores a dimension→score (1..5) map in
 *  rubric_json; this averages each dimension across the artifacts. Returns the eight dimensions in
 *  canonical order (each null when no artifact scored it). constitution §5: scores only. */
export async function getRunRubricDimensionAverages(
  releaseRunId: string,
): Promise<readonly RubricDimensionAverage[]> {
  const result = await query<RubricJsonRow>(
    `SELECT rubric_json
       FROM eval_runs
      WHERE release_run_id = $1 AND eval_type = 'rubric'`,
    [releaseRunId],
  );
  const maps = result.rows.map((row) => row.rubric_json ?? {});
  return averageRubricDimensions(maps);
}

/** One run's rubric rollup over time — the point on the cross-run Quality-Signals trend. */
export interface RubricTrendPoint {
  readonly release_run_id: string;
  readonly repo: string;
  readonly started_at: string;
  /** Mean of the scored dimensions (1..5), or null when no artifact was scored. */
  readonly overall: number | null;
  readonly dimensions: readonly RubricDimensionAverage[];
  /** How many approved artifacts contributed a rubric in this run. */
  readonly artifact_count: number;
}

interface RubricTrendRawRow {
  release_run_id: string;
  repo: string;
  started_at: Date | string;
  rubric_json: RubricMap | null;
}

/** Rubric scores per run across the most recent `limit` runs that have a rubric, oldest-first so
 *  the caller can plot the trend (and read drift = last − first). Each run's per-dimension averages
 *  are computed with the SAME `averageRubricDimensions` the per-run page uses, so they never
 *  disagree. constitution §2/§5: scores only; every query parameterised. */
export async function listRubricTrendAcrossRuns(
  limit = 50,
): Promise<readonly RubricTrendPoint[]> {
  const result = await query<RubricTrendRawRow>(
    // Pick the N most-recent runs that have rubric rows, then fetch all those runs' rubric maps
    // (a run has one rubric row per approved artifact) ordered oldest-first for the trend.
    `WITH recent_runs AS (
        SELECT er.release_run_id, rr.repo, rr.started_at
          FROM eval_runs er
          JOIN release_runs rr ON rr.id = er.release_run_id
         WHERE er.eval_type = 'rubric'
         GROUP BY er.release_run_id, rr.repo, rr.started_at
         ORDER BY rr.started_at DESC
         LIMIT $1
      )
      SELECT r.release_run_id, r.repo, r.started_at, er.rubric_json
        FROM recent_runs r
        JOIN eval_runs er
          ON er.release_run_id = r.release_run_id AND er.eval_type = 'rubric'
       ORDER BY r.started_at ASC`,
    [limit],
  );

  // Group the per-artifact rubric maps by run, then roll each run up to per-dimension averages.
  const byRun = new Map<string, { repo: string; started_at: string; maps: RubricMap[] }>();
  for (const row of result.rows) {
    const startedAt = row.started_at instanceof Date ? row.started_at.toISOString() : String(row.started_at);
    const entry = byRun.get(row.release_run_id) ?? { repo: row.repo, started_at: startedAt, maps: [] };
    entry.maps.push(row.rubric_json ?? {});
    byRun.set(row.release_run_id, entry);
  }

  return [...byRun.entries()].map(([release_run_id, { repo, started_at, maps }]) => {
    const dimensions = averageRubricDimensions(maps);
    return {
      release_run_id,
      repo,
      started_at,
      overall: rubricOverall(dimensions),
      dimensions,
      artifact_count: maps.length,
    };
  });
}
