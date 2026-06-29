// UX review R10 — the conversion funnel that closes the ROI loop: generated → approved →
// published → engaged. Pure types + shaping (the Aurora reads live in app/lib/db/funnelStats.ts,
// the markup in app/components/ConversionFunnel.ts). constitution §5: these are aggregate counts
// only — never an artifact body, claim, or reviewer identity.

export interface FunnelCounts {
  /** Artifacts the pipeline generated (every draft, across all runs). */
  readonly generated: number;
  /** Artifacts approved at Gate #2 (the §18.1 immutable snapshots). */
  readonly approved: number;
  /** Distinct artifacts published to at least one external destination. */
  readonly published: number;
  /** Distinct artifacts with at least one recorded engagement metric (UTM/ROI loop). */
  readonly engaged: number;
}

/** One rendered funnel stage. `pctOfTop` is width relative to the first stage (the bar);
 *  `stepPct` is the conversion from the PREVIOUS stage (null for the first). */
export interface FunnelStage {
  readonly key: 'generated' | 'approved' | 'published' | 'engaged';
  readonly label: string;
  readonly count: number;
  readonly pctOfTop: number;
  readonly stepPct: number | null;
  readonly detail: string;
}

/** Integer percent, guarding divide-by-zero (0 denominator → 0%). */
function pct(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 100);
}

const STAGE_META: readonly { key: FunnelStage['key']; label: string; detail: string }[] = [
  { key: 'generated', label: 'Generated', detail: 'drafts produced by the pipeline' },
  { key: 'approved', label: 'Approved', detail: 'passed Gate #2 with full provenance' },
  { key: 'published', label: 'Published', detail: 'shipped to an external channel' },
  { key: 'engaged', label: 'Engaged', detail: 'drove recorded engagement' },
];

/** Shape the four counts into an ordered funnel. The bar width (`pctOfTop`) is relative to the
 *  top stage so the narrowing reads as a funnel; `stepPct` is the stage-over-stage conversion. */
export function buildFunnel(counts: FunnelCounts): readonly FunnelStage[] {
  const ordered = [counts.generated, counts.approved, counts.published, counts.engaged];
  const top = ordered[0] ?? 0;
  return STAGE_META.map((meta, i) => {
    const count = ordered[i] ?? 0;
    const prev = i === 0 ? null : (ordered[i - 1] ?? 0);
    return {
      key: meta.key,
      label: meta.label,
      count,
      pctOfTop: pct(count, top),
      stepPct: prev === null ? null : pct(count, prev),
      detail: meta.detail,
    };
  });
}

/** True when there is nothing to chart yet (no artifacts generated) — drives an honest empty state. */
export function funnelIsEmpty(counts: FunnelCounts): boolean {
  return counts.generated <= 0;
}
