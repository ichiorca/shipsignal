// T5/T6 (spec 013) — eval_runs repository: typed reads of a run's evaluation results for the
// dashboard + read API (PRD §10.7 eval_runs, §17 metrics/rubric; migration 0012). P5 (Safety
// rails) + constitution §2/§5: every query is parameterised and scoped by release_run_id (the
// tenancy key — no cross-run bleed), and a row carries ONLY scores + aggregate counts (no prompt,
// evidence, or artifact body), so nothing sensitive reaches the browser or the API response.

import { query } from '@/app/lib/aurora.ts';
import { summarizeEvals } from '@/app/lib/evalMetrics.ts';
import type { EvalRunRow, RunEvalSummary } from '@/app/lib/evalMetrics.ts';

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
