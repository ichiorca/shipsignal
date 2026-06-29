// UX review R10 — the conversion-funnel aggregation (generated → approved → published → engaged).
// P5: parameter-free aggregate reads over tables this app already owns; only counts leave this
// boundary (no text columns are selected). Cross-run BY DESIGN: the dashboard tells the whole-
// product story (same read-only, deliberately-global posture as the hero stats). Shaping +
// markup live in app/lib/funnel.ts / app/components/ConversionFunnel.ts.

import { unstable_cache } from 'next/cache';
import { query } from '@/app/lib/aurora.ts';
import type { FunnelCounts } from '@/app/lib/funnel.ts';

// Like the hero stats, these are whole-product counts over growing tables and the dashboard is
// force-dynamic, so cache for a short window rather than re-scanning on every request.
const FUNNEL_REVALIDATE_SECONDS = 60;

interface FunnelRow {
  generated: string | number;
  approved: string | number;
  published: string | number;
  engaged: string | number;
}

function asInt(value: string | number): number {
  return typeof value === 'number' ? value : Number.parseInt(value, 10);
}

async function queryFunnelCounts(): Promise<FunnelCounts> {
  const result = await query<FunnelRow>(
    `SELECT
       (SELECT count(*) FROM artifacts)                                   AS generated,
       (SELECT count(*) FROM approved_artifact_snapshots)                 AS approved,
       (SELECT count(DISTINCT target_id) FROM approvals
          WHERE target_type = 'artifact_publish')                        AS published,
       (SELECT count(DISTINCT artifact_id) FROM engagement_metrics)       AS engaged`,
    [],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error('funnel counts aggregate returned no row');
  }
  return {
    generated: asInt(row.generated),
    approved: asInt(row.approved),
    published: asInt(row.published),
    engaged: asInt(row.engaged),
  };
}

/** Cached conversion-funnel counts for the dashboard (short revalidate window). */
export const getFunnelCounts = unstable_cache(queryFunnelCounts, ['funnel-counts'], {
  revalidate: FUNNEL_REVALIDATE_SECONDS,
});
