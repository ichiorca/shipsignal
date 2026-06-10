// T5 (spec 013) — pure eval-view types + score formatting (PRD §17.1 metrics, §13.1 Eval
// dashboard). Kept free of any DB / `server-only` import (unlike app/lib/db/evalRuns.ts) so the
// EvalDashboard component, the page, AND the unit test share one definition of the shape and the
// formatting. constitution §5: these shapes carry only metric scores + aggregate counts — never
// a prompt, evidence, artifact body, or PII.

/** The seven product-quality metric names (PRD §17.1), plus the spec-020 notify→decision
 *  latency split and the spec-021 engagement outcome totals. Matches the Python
 *  `MetricName` enum so the worker writes and the dashboard reads the same `eval_type`
 *  strings. */
export type MetricName =
  | 'evidence_coverage'
  | 'unsupported_claim_rate'
  | 'edit_distance'
  | 'approval_latency_seconds'
  | 'notify_to_decision_latency_seconds'
  | 'feature_rejection_rate'
  | 'skill_candidate_acceptance_rate'
  | 'media_success_rate'
  | 'engagement_views_total'
  | 'engagement_clicks_total'
  | 'engagement_conversions_total';

/** PRD §17.1 order — deterministic for the dashboard + tests. T5 (spec 020): the
 *  notify→decision split renders directly after approval latency (the AC: surfaced
 *  alongside it, splitting "time to notice" from "time to decide"). */
export const METRIC_ORDER: readonly MetricName[] = [
  'evidence_coverage',
  'unsupported_claim_rate',
  'edit_distance',
  'approval_latency_seconds',
  'notify_to_decision_latency_seconds',
  'feature_rejection_rate',
  'skill_candidate_acceptance_rate',
  'media_success_rate',
  // T1 (spec 021): the §17.1 outcome extension — last, after the quality metrics.
  'engagement_views_total',
  'engagement_clicks_total',
  'engagement_conversions_total',
] as const;

export const METRIC_LABELS: Record<MetricName, string> = {
  evidence_coverage: 'Evidence coverage',
  unsupported_claim_rate: 'Unsupported-claim rate',
  edit_distance: 'Edit distance (reviewer rewrite)',
  approval_latency_seconds: 'Approval latency',
  notify_to_decision_latency_seconds: 'Notify-to-decision latency',
  feature_rejection_rate: 'Feature rejection rate',
  skill_candidate_acceptance_rate: 'Skill-candidate acceptance rate',
  media_success_rate: 'Media success rate',
  engagement_views_total: 'Engagement: views (run total)',
  engagement_clicks_total: 'Engagement: clicks (run total)',
  engagement_conversions_total: 'Engagement: conversions (run total)',
};

/** Metrics whose score is a 0..1 rate rendered as a percentage. */
const RATE_METRICS: ReadonlySet<MetricName> = new Set([
  'evidence_coverage',
  'unsupported_claim_rate',
  'edit_distance',
  'feature_rejection_rate',
  'skill_candidate_acceptance_rate',
  'media_success_rate',
]);

/** One raw eval row as read from `eval_runs` (newest first). `findings` is the jsonb map. */
export interface EvalRunRow {
  readonly eval_type: string;
  readonly score: number | null;
  readonly findings: Readonly<Record<string, unknown>>;
  readonly created_at: string;
}

/** One metric shaped for the dashboard: its label, raw score, and human-readable display + detail. */
export interface EvalMetric {
  readonly name: MetricName;
  readonly label: string;
  readonly score: number | null;
  readonly display: string;
  readonly detail: string;
}

/** The per-run eval summary the dashboard renders: the seven metrics plus a rubric headline. */
export interface RunEvalSummary {
  readonly metrics: readonly EvalMetric[];
  readonly rubricAverage: number | null;
  readonly rubricCount: number;
}

/** Metrics whose score is a duration in seconds rendered as a human time span. */
const DURATION_METRICS: ReadonlySet<MetricName> = new Set([
  'approval_latency_seconds',
  'notify_to_decision_latency_seconds',
]);

/** T1 (spec 021): metrics whose score is an aggregate count. A null score means the
 *  engagement was never reported — rendered "not yet reported", NEVER 0 (spec AC). */
const COUNT_METRICS: ReadonlySet<MetricName> = new Set([
  'engagement_views_total',
  'engagement_clicks_total',
  'engagement_conversions_total',
]);

/** Format a metric's headline score as text (constitution P6: never colour/number alone). */
export function formatScore(name: MetricName, score: number | null): string {
  if (score === null) {
    return COUNT_METRICS.has(name) ? 'not yet reported' : 'n/a';
  }
  if (DURATION_METRICS.has(name)) {
    return humanizeSeconds(score);
  }
  if (RATE_METRICS.has(name)) {
    return `${(score * 100).toFixed(1)}%`;
  }
  if (COUNT_METRICS.has(name)) {
    return Math.trunc(score).toLocaleString('en-US');
  }
  return score.toFixed(2);
}

/** Seconds → a compact human duration (e.g. "2h 5m", "3m 20s", "45s"). */
export function humanizeSeconds(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}h ${m}m`;
  }
  if (m > 0) {
    return `${m}m ${s}s`;
  }
  return `${s}s`;
}

function asCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** A short, PII-free detail string from a metric's findings (numerator/denominator or samples). */
export function formatDetail(name: MetricName, findings: Readonly<Record<string, unknown>>): string {
  // T4 (spec 022): the worker marks media_success_rate not-applicable when the run
  // deselected demo_script — say why, instead of a bare dash.
  if (findings.not_applicable === 'demo_script_not_selected') {
    return 'not applicable — demo script was not selected for this run';
  }
  const numerator = asCount(findings.numerator);
  const denominator = asCount(findings.denominator);
  const sampleCount = asCount(findings.sample_count);
  if (numerator !== null && denominator !== null) {
    const scope = findings.scope === 'repo_global' ? ' (repo-wide)' : '';
    return `${numerator} / ${denominator}${scope}`;
  }
  if (sampleCount !== null) {
    return `${sampleCount} sample${sampleCount === 1 ? '' : 's'}`;
  }
  return '—';
}

function toNumberOrNull(value: number | null): number | null {
  return value === null || Number.isNaN(value) ? null : value;
}

/** Reduce raw eval rows into the per-run dashboard summary. Picks the LATEST row per metric
 *  (rows arrive newest-first) so a re-evaluated run shows current scores, and averages the
 *  rubric rows into one headline. Pure — the db reader, the page, and the test share it. */
export function summarizeEvals(rows: readonly EvalRunRow[]): RunEvalSummary {
  const latestByType = new Map<string, EvalRunRow>();
  const rubricScores: number[] = [];
  for (const row of rows) {
    if (row.eval_type === 'rubric') {
      if (row.score !== null) {
        rubricScores.push(row.score);
      }
      continue;
    }
    // Rows are ordered newest-first; keep the first seen per eval_type.
    if (!latestByType.has(row.eval_type)) {
      latestByType.set(row.eval_type, row);
    }
  }

  const metrics: EvalMetric[] = METRIC_ORDER.map((name) => {
    const row = latestByType.get(name);
    const score = row ? toNumberOrNull(row.score) : null;
    const findings = row?.findings ?? {};
    return {
      name,
      label: METRIC_LABELS[name],
      score,
      display: formatScore(name, score),
      detail: formatDetail(name, findings),
    };
  });

  const rubricAverage =
    rubricScores.length === 0
      ? null
      : rubricScores.reduce((a, b) => a + b, 0) / rubricScores.length;

  return { metrics, rubricAverage, rubricCount: rubricScores.length };
}
