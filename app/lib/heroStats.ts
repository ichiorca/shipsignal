// Hero value metrics (operator feedback 2026-06-09, priority 2): the home page tells the
// ROI story from data the pipeline already records — speed (tag → approved content), spend
// (model cost per release vs a PMM-hours baseline), trust (% claims evidence-backed), and
// output (artifacts shipped). Pure types + formatting; the Aurora reads live in
// app/lib/db/heroStats.ts, the markup in app/components/HeroStats.ts.
//
// constitution §5: these shapes carry only aggregate numbers — never a prompt, evidence
// excerpt, artifact body, or reviewer identity.

/** What hand-writing one release's content costs without the pipeline. The framing baseline
 *  the operator chose ("model cost vs ~4h of PMM time"); a label, not a billed figure. */
export const PMM_BASELINE_HOURS_PER_RELEASE = 4;

export interface HeroStatsData {
  /** Approved artifacts across all runs (the §18.1 publishable snapshots). */
  readonly artifactsShipped: number;
  /** supported / total over every extracted claim; null when no claims exist yet. */
  readonly claimsEvidenceBackedRate: number | null;
  /** Median seconds from run start (the tag/trigger) to its FIRST Gate #2 approval;
   *  null until at least one run has approved content. */
  readonly medianSecondsToApprovedContent: number | null;
  /** Mean model spend (USD) per run that recorded telemetry; null with no telemetry. */
  readonly avgModelCostPerRunUsd: number | null;
  /** Runs that have at least one approved artifact. */
  readonly releasesWithApprovedContent: number;
}

/** One rendered stat: a headline value + the label and supporting detail under it. */
export interface HeroStat {
  readonly key: string;
  readonly value: string;
  readonly label: string;
  readonly detail: string;
}

export function formatUsd(amount: number): string {
  return amount < 0.01 && amount > 0 ? '<$0.01' : `$${amount.toFixed(2)}`;
}

/** Seconds → "Xm" / "X.Yh" headline (coarse on purpose — it's a hero number). */
export function formatDuration(seconds: number): string {
  const minutes = seconds / 60;
  if (minutes < 90) return `${Math.max(1, Math.round(minutes))}m`;
  return `${(minutes / 60).toFixed(1)}h`;
}

/** Shape the aggregates into the four hero stats, with honest placeholders ("—") before
 *  any data exists, so an empty deployment never fabricates a number. */
export function buildHeroStats(data: HeroStatsData): readonly HeroStat[] {
  const rate = data.claimsEvidenceBackedRate;
  return [
    {
      key: 'speed',
      value:
        data.medianSecondsToApprovedContent === null
          ? '—'
          : formatDuration(data.medianSecondsToApprovedContent),
      label: 'tag → approved content',
      detail:
        data.releasesWithApprovedContent === 0
          ? 'median, once a release completes review'
          : `median across ${data.releasesWithApprovedContent} release${
              data.releasesWithApprovedContent === 1 ? '' : 's'
            }`,
    },
    {
      key: 'cost',
      value: data.avgModelCostPerRunUsd === null ? '—' : formatUsd(data.avgModelCostPerRunUsd),
      label: 'model cost per release',
      detail: `vs ~${PMM_BASELINE_HOURS_PER_RELEASE}h of PMM drafting time per release`,
    },
    {
      key: 'trust',
      value: rate === null ? '—' : `${Math.round(rate * 100)}%`,
      label: 'claims evidence-backed',
      detail: 'every published claim links to concrete evidence',
    },
    {
      key: 'output',
      value: String(data.artifactsShipped),
      label: 'artifacts shipped',
      detail: 'human-approved at Gate #2',
    },
  ];
}
