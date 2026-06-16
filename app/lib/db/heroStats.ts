// Hero value metrics — the Aurora aggregation (operator feedback 2026-06-09, priority 2).
// P5: parameter-free aggregate reads over tables this app already owns; only counts/sums
// leave this boundary (no text columns are selected). Cross-run BY DESIGN: the home page
// tells the whole-product story (this is a deliberate, read-only exception to per-run
// scoping — the same posture as the repo-global skill-candidate metric in spec 013).

import { unstable_cache } from 'next/cache';
import { query } from '@/app/lib/aurora.ts';
import type { HeroStatsData } from '@/app/lib/heroStats.ts';

// These whole-product aggregates run a count/median over growing tables (approved_artifact_
// snapshots, artifact_claims, model_call_telemetry) and the home page is `force-dynamic` — so
// the raw query would fire on EVERY request, and N concurrent reviewers cause N parallel full
// scans. The numbers don't need to be live-to-the-second, so cache them in the data cache for a
// short window; revalidation refreshes lazily in the background.
const HERO_STATS_REVALIDATE_SECONDS = 60;

interface AggregateRow {
  artifacts_shipped: string | number;
  releases_with_content: string | number;
  total_claims: string | number;
  supported_claims: string | number;
  median_seconds: string | number | null;
  avg_cost_usd: string | number | null;
}

function asInt(value: string | number): number {
  return Math.trunc(Number(value));
}

function asNumOrNull(value: string | number | null): number | null {
  return value === null ? null : Number(value);
}

/** One round trip for all four hero aggregates (scalar subqueries). Wrapped by `getHeroStats`
 *  below in a short-lived data cache so the home page does not re-run it on every request. */
async function queryHeroStats(): Promise<HeroStatsData> {
  const result = await query<AggregateRow>(
    `SELECT
       (SELECT count(*) FROM approved_artifact_snapshots)                       AS artifacts_shipped,
       (SELECT count(DISTINCT release_run_id) FROM approved_artifact_snapshots) AS releases_with_content,
       (SELECT count(*) FROM artifact_claims)                                   AS total_claims,
       (SELECT count(*) FROM artifact_claims WHERE support_status = 'supported') AS supported_claims,
       (SELECT percentile_cont(0.5) WITHIN GROUP
          (ORDER BY EXTRACT(EPOCH FROM (s.first_approved_at - r.started_at)))
          FROM (SELECT release_run_id, min(approved_at) AS first_approved_at
                  FROM approved_artifact_snapshots GROUP BY release_run_id) s
          JOIN release_runs r ON r.id = s.release_run_id
         WHERE s.first_approved_at > r.started_at)                              AS median_seconds,
       (SELECT avg(run_cost) FROM
          (SELECT sum(cost_usd_estimate) AS run_cost
             FROM model_call_telemetry GROUP BY release_run_id) c)              AS avg_cost_usd`,
    [],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error('hero stats aggregate returned no row');
  }
  const totalClaims = asInt(row.total_claims);
  return {
    artifactsShipped: asInt(row.artifacts_shipped),
    releasesWithApprovedContent: asInt(row.releases_with_content),
    claimsEvidenceBackedRate:
      totalClaims === 0 ? null : asInt(row.supported_claims) / totalClaims,
    medianSecondsToApprovedContent: asNumOrNull(row.median_seconds),
    avgModelCostPerRunUsd: asNumOrNull(row.avg_cost_usd),
  };
}

/** Cached (≤60s) wrapper over `queryHeroStats`. Same signature as before — callers are
 *  unaffected — but repeated home-page renders within the window reuse the cached aggregate
 *  instead of re-scanning the ledger tables. */
export const getHeroStats = unstable_cache(queryHeroStats, ['hero-stats'], {
  revalidate: HERO_STATS_REVALIDATE_SECONDS,
});
