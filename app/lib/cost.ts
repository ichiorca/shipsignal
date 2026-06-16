// T5 (spec 011) — pure cost-view types + run-total arithmetic (PRD §6 cost/latency bar, §17
// cost metrics). Kept free of any DB / `server-only` import (unlike app/lib/db/modelCallTelemetry.ts)
// so the cost component, the page, AND the unit test can all share one definition of the shape
// and the summation without dragging in pg. constitution §5: these shapes carry only metrics +
// provenance — node, model, tier, tokens, latency, USD estimate — never a prompt/evidence/output.

/** One node's aggregated spend for a run (grouped by node + model). `model_tier` is the routed
 *  tier (model_routing.ModelTier) so the view can show which band a node runs on. */
export interface CostByNode {
  readonly node_name: string;
  readonly model_id: string;
  readonly model_tier: string;
  readonly calls: number;
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly latency_ms_total: number;
  readonly cost_usd: number;
}

/** Run-level totals across every node, for the breakdown's summary/footer row. */
export interface CostTotals {
  readonly calls: number;
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly latency_ms_total: number;
  readonly cost_usd: number;
}

/** The full cost breakdown the cost page renders. */
export interface RunCostBreakdown {
  readonly byNode: readonly CostByNode[];
  readonly totals: CostTotals;
}

/** One node's total spend (summed across every model that node ran on). The "where the spend
 *  goes by node" chart rolls up to this so each node appears exactly once. */
export interface NodeCost {
  readonly node_name: string;
  readonly cost_usd: number;
}

/** Roll per-(node,model) rows up to per-node spend, summing across models, most-expensive first.
 *  `byNode` arrives grouped by node+model, so a single node can appear multiple times; this
 *  collapses those into one entry per node (the chart needs unique node labels + a true rollup). */
export function aggregateCostByNode(byNode: readonly CostByNode[]): readonly NodeCost[] {
  const totals = new Map<string, number>();
  for (const row of byNode) {
    totals.set(row.node_name, (totals.get(row.node_name) ?? 0) + row.cost_usd);
  }
  return [...totals.entries()]
    .map(([node_name, cost_usd]) => ({ node_name, cost_usd }))
    .sort((a, b) => b.cost_usd - a.cost_usd);
}

/** Sum per-node rows into run totals. Pure — the cost view, the page, and the test share this
 *  one implementation so they never disagree on the arithmetic. */
export function summarizeCost(byNode: readonly CostByNode[]): CostTotals {
  return byNode.reduce<CostTotals>(
    (acc, n) => ({
      calls: acc.calls + n.calls,
      input_tokens: acc.input_tokens + n.input_tokens,
      output_tokens: acc.output_tokens + n.output_tokens,
      latency_ms_total: acc.latency_ms_total + n.latency_ms_total,
      cost_usd: acc.cost_usd + n.cost_usd,
    }),
    { calls: 0, input_tokens: 0, output_tokens: 0, latency_ms_total: 0, cost_usd: 0 },
  );
}
