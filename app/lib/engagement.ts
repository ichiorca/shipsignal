// T1/T5 (spec 021) — pure engagement/ROI types + arithmetic (PRD §17.1 outcome extension).
// Kept free of any DB / `server-only` import (mirrors app/lib/cost.ts) so the ROI component,
// the pages, the ingestion route, AND the unit tests share one definition of the closed metric
// vocabulary and the cost-vs-outcome math. GDPR rails (load-bearing for this spec): these
// shapes carry ONLY aggregate counts per artifact type — there is no field that could hold a
// user id, IP, cookie, or event payload. `null` always means "not yet reported" and is kept
// distinct from a reported 0 (spec AC: missing engagement never renders as zero).

import type { CostByNode, RunCostBreakdown } from '@/app/lib/cost.ts';

/** The closed metric vocabulary — matches the `engagement_metrics.metric` CHECK constraint
 *  (migration 0021) and the Python `EngagementMetricKind`, so every layer agrees. */
export const ENGAGEMENT_METRIC_KINDS = ['views', 'clicks', 'conversions'] as const;
export type EngagementMetricKind = (typeof ENGAGEMENT_METRIC_KINDS)[number];

export function isEngagementMetricKind(value: string): value is EngagementMetricKind {
  return (ENGAGEMENT_METRIC_KINDS as readonly string[]).includes(value);
}

/** Where an ingested aggregate came from — matches the `source` CHECK constraint. The
 *  source is derived server-side from the ingestion door (JSON body → 'api', uploaded
 *  CSV → 'manual_csv'), never client-supplied, so provenance cannot be spoofed. */
export const ENGAGEMENT_SOURCES = ['manual_csv', 'api'] as const;
export type EngagementSource = (typeof ENGAGEMENT_SOURCES)[number];

/** Aggregate engagement for one artifact type: the freshest reported value per (artifact,
 *  metric) summed across the type's artifacts. `null` = not yet reported (never zero). */
export interface EngagementByType {
  readonly artifact_type: string;
  readonly views: number | null;
  readonly clicks: number | null;
  readonly conversions: number | null;
  /** ISO date (YYYY-MM-DD) of the freshest row feeding the totals, for "as of" display. */
  readonly latest_as_of: string | null;
}

/** One ROI table row: an artifact type's apportioned generation cost next to its
 *  ingested engagement. */
export interface RoiRow {
  readonly artifact_type: string;
  /** Even share of the run's artifact-generation cost (see ARTIFACT_GENERATION_NODES);
   *  null when no generation telemetry exists for the run. */
  readonly apportioned_cost_usd: number | null;
  readonly views: number | null;
  readonly clicks: number | null;
  readonly conversions: number | null;
  readonly latest_as_of: string | null;
}

/** The ROI view the release-detail and cost pages render. */
export interface RoiSummary {
  readonly rows: readonly RoiRow[];
  /** Full run cost (every node) — the "what we spent" side of the run totals. */
  readonly run_cost_usd: number;
  readonly total_views: number | null;
  readonly total_clicks: number | null;
  readonly total_conversions: number | null;
  /** run_cost_usd / total_clicks; null unless both sides exist (spec AC). */
  readonly cost_per_click_usd: number | null;
}

/** The telemetry node families that produce artifacts (model_routing routes artifact prose
 *  under the 'generate_' prefix and claim decomposition under 'extract_claims_'; telemetry
 *  records the ROUTE key, not the per-type task name — see cost_telemetry.meter_call). That
 *  prefix-level grain is why per-type cost is an even APPORTIONMENT, not a measurement. */
export const ARTIFACT_GENERATION_NODES: ReadonlySet<string> = new Set([
  'generate_',
  'extract_claims_',
]);

/** The run's artifact-generation spend (the cost the ROI table apportions per type). */
export function artifactGenerationCostUsd(byNode: readonly CostByNode[]): number {
  return byNode
    .filter((n) => ARTIFACT_GENERATION_NODES.has(n.node_name))
    .reduce((sum, n) => sum + n.cost_usd, 0);
}

/** Cost-per-click only when both sides exist: a recorded cost AND reported clicks > 0.
 *  Returns null otherwise — never a fabricated 0 or an Infinity. */
export function costPerClickUsd(costUsd: number, clicks: number | null): number | null {
  if (clicks === null || clicks <= 0 || costUsd <= 0) return null;
  return costUsd / clicks;
}

/** Sum reported values, preserving "nothing reported at all" as null (never zero). */
function sumReported(values: readonly (number | null)[]): number | null {
  const reported = values.filter((v): v is number => v !== null);
  if (reported.length === 0) return null;
  return reported.reduce((a, b) => a + b, 0);
}

/** Assemble the ROI view: one row per artifact type the run produced (engagement-less types
 *  still get a row so "not yet reported" is visible), the run-level totals, and
 *  cost-per-click when both sides exist. Pure — pages, component, and tests share it. */
export function buildRoiSummary(
  artifactTypes: readonly string[],
  engagement: readonly EngagementByType[],
  breakdown: RunCostBreakdown,
): RoiSummary {
  const byType = new Map(engagement.map((e) => [e.artifact_type, e]));
  // Union, in case an engagement row references a type absent from the draft list.
  const types = [...new Set([...artifactTypes, ...byType.keys()])].sort();

  const generationCost = artifactGenerationCostUsd(breakdown.byNode);
  const apportioned =
    types.length > 0 && generationCost > 0 ? generationCost / types.length : null;

  const rows: RoiRow[] = types.map((artifact_type) => {
    const e = byType.get(artifact_type);
    return {
      artifact_type,
      apportioned_cost_usd: apportioned,
      views: e?.views ?? null,
      clicks: e?.clicks ?? null,
      conversions: e?.conversions ?? null,
      latest_as_of: e?.latest_as_of ?? null,
    };
  });

  const totalClicks = sumReported(rows.map((r) => r.clicks));
  const runCost = breakdown.totals.cost_usd;
  return {
    rows,
    run_cost_usd: runCost,
    total_views: sumReported(rows.map((r) => r.views)),
    total_clicks: totalClicks,
    total_conversions: sumReported(rows.map((r) => r.conversions)),
    cost_per_click_usd: costPerClickUsd(runCost, totalClicks),
  };
}
