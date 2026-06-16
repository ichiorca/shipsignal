// Cross-run learning trend (operator feedback 2026-06-09, priority 3): the proof that the
// skill self-learning loop COMPOUNDS — reviewer edit distance and feature rejection rate
// falling across runs as skill versions promote. Pure shaping + formatting; the Aurora
// reads live in app/lib/db/learningTrends.ts, the markup in app/components/LearningTrends.ts.
//
// constitution §5: only metric scores, counts, run ids, skill names and versions flow
// through these shapes — never reviewer text, prompts, or skill bodies.

/** One run's learning-relevant metric snapshot, oldest run first. */
export interface RunTrendPoint {
  readonly release_run_id: string;
  readonly started_at: string;
  /** Mean reviewer rewrite ratio (0..1) for the run; null when not measured. */
  readonly edit_distance: number | null;
  /** Share of feature candidates the reviewer rejected (0..1); null when not measured. */
  readonly feature_rejection_rate: number | null;
}

/** One promoted skill version (Gate #3 approvals that replaced a repo SKILL.md). */
export interface SkillPromotionPoint {
  readonly skill_name: string;
  readonly proposed_version: string;
  readonly reviewed_at: string | null;
}

export interface TrendSummary {
  /** e.g. "Reviewer rewriting fell 57% across 6 measured runs." — or an honest
   *  not-enough-data statement. */
  readonly headline: string;
  readonly direction: 'improving' | 'worsening' | 'flat' | 'insufficient-data';
}

function mean(values: readonly number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Compare the first and second halves of the measured series. Two measured points is the
 *  floor (one point proves nothing); a <5%-relative move reads as flat. */
export function summarizeTrend(
  points: readonly (number | null)[],
  subject: string,
): TrendSummary {
  const measured = points.filter((p): p is number => p !== null);
  if (measured.length < 2) {
    return {
      headline: `${subject}: not enough measured runs yet to show a trend (need 2+).`,
      direction: 'insufficient-data',
    };
  }
  const mid = Math.ceil(measured.length / 2);
  const earlier = mean(measured.slice(0, mid));
  const later = mean(measured.slice(mid));
  if (earlier === 0 && later === 0) {
    return { headline: `${subject} held at 0 across ${measured.length} measured runs.`, direction: 'flat' };
  }
  const base = Math.max(earlier, later);
  const change = (later - earlier) / base;
  if (Math.abs(change) < 0.05) {
    return {
      headline: `${subject} held steady across ${measured.length} measured runs.`,
      direction: 'flat',
    };
  }
  const pct = Math.round(Math.abs(change) * 100);
  return later < earlier
    ? {
        headline: `${subject} fell ${pct}% across ${measured.length} measured runs — the skill loop is compounding.`,
        direction: 'improving',
      }
    : {
        headline: `${subject} rose ${pct}% across ${measured.length} measured runs.`,
        direction: 'worsening',
      };
}

/** Inline sparkline geometry: scale a series into SVG polyline points (width 200 × height
 *  40, padded). Purely decorative — the table next to it carries the data (P6: the chart is
 *  aria-hidden; nothing is conveyed by the drawing alone). Null points are skipped. */
export function sparklinePoints(values: readonly (number | null)[]): string {
  const measured = values
    .map((v, i) => ({ v, i }))
    .filter((p): p is { v: number; i: number } => p.v !== null);
  if (measured.length < 2) return '';
  const max = Math.max(...measured.map((p) => p.v), 0.0001);
  const lastIndex = values.length - 1;
  return measured
    .map(({ v, i }) => {
      const x = 4 + (i / Math.max(lastIndex, 1)) * 192;
      const y = 36 - (v / max) * 32;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

/** Render a 0..1 ratio as a percent cell, with an em dash for unmeasured runs. */
export function percentCell(value: number | null): string {
  return value === null ? '—' : `${(value * 100).toFixed(0)}%`;
}
