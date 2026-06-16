// Cross-run learning trend — the Aurora reads (operator feedback 2026-06-09, priority 3).
// P5: parameterised aggregate reads; only scores/counts/names/versions are selected (no
// reviewer text, no proposed skill bodies). Cross-run BY DESIGN — the trend view exists to
// show the loop compounding across releases (same read-only posture as the hero stats).

import { query } from '@/app/lib/aurora.ts';
import type { RunTrendPoint, SkillPromotionPoint } from '@/app/lib/learningTrends.ts';

interface TrendRow {
  release_run_id: string;
  started_at: string | Date;
  edit_distance: string | number | null;
  feature_rejection_rate: string | number | null;
}

interface PromotionRow {
  skill_name: string;
  proposed_version: string;
  reviewed_at: string | Date | null;
}

function asIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function asNumOrNull(value: string | number | null): number | null {
  return value === null ? null : Number(value);
}

/** Per-run learning metrics, oldest run first: each run's LATEST edit_distance and
 *  feature_rejection_rate eval rows (a re-evaluated run shows its current score). Bounded
 *  to the most recent `limit` runs that have any eval at all. */
export async function listRunTrendPoints(limit = 30): Promise<readonly RunTrendPoint[]> {
  const result = await query<TrendRow>(
    // `latest` keeps each run's most-recent score per metric (backed by ix_eval_runs_learning_types,
    // migration 0029); `per_run` pivots those two metrics into one row per run via conditional
    // aggregate, then a single JOIN to release_runs — replacing the prior two correlated scalar
    // subqueries + EXISTS that re-probed per row.
    `WITH latest AS (
       SELECT DISTINCT ON (release_run_id, eval_type)
              release_run_id, eval_type, score
         FROM eval_runs
        WHERE eval_type IN ('edit_distance', 'feature_rejection_rate')
        ORDER BY release_run_id, eval_type, created_at DESC
     ),
     per_run AS (
       SELECT release_run_id,
              MAX(score) FILTER (WHERE eval_type = 'edit_distance')          AS edit_distance,
              MAX(score) FILTER (WHERE eval_type = 'feature_rejection_rate') AS feature_rejection_rate
         FROM latest
        GROUP BY release_run_id
     )
     SELECT r.id AS release_run_id,
            r.started_at,
            p.edit_distance,
            p.feature_rejection_rate
       FROM per_run p
       JOIN release_runs r ON r.id = p.release_run_id
      ORDER BY r.started_at DESC
      LIMIT $1`,
    [limit],
  );
  // Newest-first from SQL (for the LIMIT); the trend reads oldest-first.
  return result.rows
    .map((row) => ({
      release_run_id: row.release_run_id,
      started_at: asIso(row.started_at),
      edit_distance: asNumOrNull(row.edit_distance),
      feature_rejection_rate: asNumOrNull(row.feature_rejection_rate),
    }))
    .reverse();
}

/** Gate #3 promotions, oldest first — the moments a skill version actually shipped. */
export async function listSkillPromotions(limit = 50): Promise<readonly SkillPromotionPoint[]> {
  const result = await query<PromotionRow>(
    `SELECT skill_name, proposed_version, reviewed_at
       FROM skill_revision_candidates
      WHERE status = 'promoted'
      ORDER BY reviewed_at ASC NULLS LAST
      LIMIT $1`,
    [limit],
  );
  return result.rows.map((row) => ({
    skill_name: row.skill_name,
    proposed_version: row.proposed_version,
    reviewed_at: row.reviewed_at === null ? null : asIso(row.reviewed_at),
  }));
}
