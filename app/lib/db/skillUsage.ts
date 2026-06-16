// skill_usage_events repository — the "which skills are actually used, and how much" read behind
// the Capabilities page (the peer app's usage view). The worker writes one row per (artifact,
// skill) during generation (graph_name/node_name/usage_type provenance); this aggregates them per
// skill. P5 / constitution §5: rows carry provenance metadata only (no prompt/evidence/output), so
// nothing sensitive reaches the client. All queries are parameterised.

import { unstable_cache } from 'next/cache';
import { query } from '@/app/lib/aurora.ts';

/** The Capabilities page does not need live-to-the-second usage; cache the aggregate briefly so
 *  repeated renders within the window reuse it instead of re-scanning skill_usage_events. */
const SKILL_USAGE_REVALIDATE_SECONDS = 60;

/** Per-skill usage rollup as the Capabilities page renders it. */
export interface SkillUsageRow {
  readonly skill_name: string;
  /** Total usage events (≈ how many artifacts this skill helped produce). */
  readonly usage_count: number;
  /** Distinct launches the skill was used in. */
  readonly run_count: number;
  /** Distinct graph/node sites that invoked it (the "agents" using the skill). */
  readonly node_count: number;
  /** Most recent use, ISO; null when never used. */
  readonly last_used: string | null;
}

interface RawRow {
  skill_name: string;
  usage_count: string | number;
  run_count: string | number;
  node_count: string | number;
  last_used: Date | string | null;
}

function asInt(value: string | number | null): number {
  return value === null ? 0 : Math.trunc(Number(value));
}

/** Per-skill usage, most-used first. Aggregated in SQL (GROUP BY skill_name) so the page ships a
 *  compact rollup, not raw per-event rows. Bounded by `limit`. Backed by ix_skill_usage_events_
 *  skill_name (migration 0029) so the GROUP BY is index-driven rather than a seq-scan. */
async function querySkillUsage(limit = 100): Promise<readonly SkillUsageRow[]> {
  const result = await query<RawRow>(
    `SELECT skill_name,
            COUNT(*)                          AS usage_count,
            COUNT(DISTINCT release_run_id)    AS run_count,
            COUNT(DISTINCT (graph_name || ':' || node_name)) AS node_count,
            MAX(created_at)                   AS last_used
       FROM skill_usage_events
      GROUP BY skill_name
      ORDER BY COUNT(*) DESC, skill_name ASC
      LIMIT $1`,
    [limit],
  );
  return result.rows.map((row) => ({
    skill_name: row.skill_name,
    usage_count: asInt(row.usage_count),
    run_count: asInt(row.run_count),
    node_count: asInt(row.node_count),
    last_used:
      row.last_used === null
        ? null
        : row.last_used instanceof Date
          ? row.last_used.toISOString()
          : row.last_used,
  }));
}

/** Cached (≤60s) wrapper over `querySkillUsage`. Same signature — callers are unaffected. */
export const listSkillUsage = unstable_cache(querySkillUsage, ['skill-usage'], {
  revalidate: SKILL_USAGE_REVALIDATE_SECONDS,
});
