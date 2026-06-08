// T5 (spec 011) — model_call_telemetry repository: typed reads of a run's per-node cost/latency
// for the dashboard cost view (PRD §2.1 model gateway, §6 cost/latency bar, §17 cost metrics;
// migration 0011). P5 (Safety rails) + constitution §2/§5: every query is parameterised and
// scoped by release_run_id (the tenancy key — no cross-run bleed), and the row carries ONLY
// metrics + provenance (node, model, tier, tokens, latency, USD estimate) — never a prompt,
// evidence, or model output, so nothing sensitive reaches the browser.

import { query } from '@/app/lib/aurora.ts';
import { summarizeCost } from '@/app/lib/cost.ts';
import type { CostByNode, RunCostBreakdown } from '@/app/lib/cost.ts';

interface CostRow {
  node_name: string;
  model_id: string;
  model_tier: string;
  // pg returns COUNT/SUM as strings; normalise to numbers below.
  calls: string | number;
  input_tokens: string | number | null;
  output_tokens: string | number | null;
  latency_ms_total: string | number | null;
  cost_usd: string | number | null;
}

function asInt(value: string | number | null): number {
  return value === null ? 0 : Math.trunc(Number(value));
}

function asNum(value: string | number | null): number {
  return value === null ? 0 : Number(value);
}

function mapRow(row: CostRow): CostByNode {
  return {
    node_name: row.node_name,
    model_id: row.model_id,
    model_tier: row.model_tier,
    calls: asInt(row.calls),
    input_tokens: asInt(row.input_tokens),
    output_tokens: asInt(row.output_tokens),
    latency_ms_total: asInt(row.latency_ms_total),
    cost_usd: asNum(row.cost_usd),
  };
}

/** Per-node cost/latency for one run (most expensive first), plus run totals. Aggregated in SQL
 *  (GROUP BY node + model) so the route ships a compact summary, not raw per-call rows. */
export async function getRunCostBreakdown(releaseRunId: string): Promise<RunCostBreakdown> {
  const result = await query<CostRow>(
    `SELECT node_name,
            model_id,
            model_tier,
            COUNT(*)              AS calls,
            SUM(input_tokens)     AS input_tokens,
            SUM(output_tokens)    AS output_tokens,
            SUM(latency_ms)       AS latency_ms_total,
            SUM(cost_usd_estimate) AS cost_usd
       FROM model_call_telemetry
      WHERE release_run_id = $1
      GROUP BY node_name, model_id, model_tier
      ORDER BY SUM(cost_usd_estimate) DESC, node_name ASC`,
    [releaseRunId],
  );
  const byNode = result.rows.map(mapRow);
  return { byNode, totals: summarizeCost(byNode) };
}
