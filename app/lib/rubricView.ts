// Frontend audit (gap #1) — pure rubric-dimension view. The LLM-as-judge rubric scores each
// approved artifact on eight dimensions (1..5) and persists the dimension→score map in
// eval_runs.rubric_json, but the per-run eval page only showed the single overall average. This
// holds the (DOM-free, server-only-free) dimension vocabulary + averaging so the eval page can
// chart the per-dimension picture, and so the logic is unit-testable under `node --test`.
//
// The dimension order + ids mirror worker/src/release_worker/eval_rubric.py::RubricDimension —
// keep them in sync (the worker is the source of truth for what it writes). constitution §5:
// operates only on numeric scores, never prompt/evidence/artifact text.

/** The eight rubric dimensions, in the worker's PRD §17.2 order, with display labels. */
export const RUBRIC_DIMENSIONS: ReadonlyArray<{ readonly key: string; readonly label: string }> = [
  { key: 'claim_support', label: 'Claim support' },
  { key: 'claim_risk', label: 'Claim risk (5 = low)' },
  { key: 'brand_voice', label: 'Brand voice' },
  { key: 'audience_relevance', label: 'Audience relevance' },
  { key: 'originality', label: 'Originality' },
  { key: 'conversion_intent', label: 'Conversion intent' },
  { key: 'clarity', label: 'Clarity' },
  { key: 'demoability', label: 'Demoability' },
];

/** The rubric score scale ceiling (scores run 1..5); the chart axis uses this as its max. */
export const RUBRIC_SCORE_MAX = 5;

export interface RubricDimensionAverage {
  readonly key: string;
  readonly label: string;
  /** Mean score across the artifacts that carried this dimension, or null if none did. */
  readonly average: number | null;
  /** How many artifact rubric rows contributed a numeric value for this dimension. */
  readonly count: number;
}

/** One artifact's rubric map (dimension id → score). Values are validated 1..5 by the worker, but
 *  this view treats the map as untrusted (it crosses the DB boundary) and ignores non-numeric or
 *  out-of-range entries rather than charting garbage. */
export type RubricMap = Readonly<Record<string, unknown>>;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Average each rubric dimension across every approved artifact's rubric map. A dimension absent
 *  from (or non-numeric in) a given map simply doesn't contribute to that dimension's mean — so a
 *  partially-scored run still charts the dimensions it does have, with an honest per-dimension count. */
export function averageRubricDimensions(
  maps: readonly RubricMap[],
): readonly RubricDimensionAverage[] {
  return RUBRIC_DIMENSIONS.map(({ key, label }) => {
    let sum = 0;
    let count = 0;
    for (const map of maps) {
      const value = map[key];
      if (isFiniteNumber(value) && value >= 1 && value <= RUBRIC_SCORE_MAX) {
        sum += value;
        count += 1;
      }
    }
    return { key, label, average: count === 0 ? null : sum / count, count };
  });
}

/** The single headline rubric number: the mean of the scored dimensions (nulls ignored), or null
 *  when nothing was scored. Used for the cross-run Quality-Signals trend + drift. */
export function rubricOverall(dimensions: readonly RubricDimensionAverage[]): number | null {
  const scored = dimensions.filter(
    (d): d is RubricDimensionAverage & { average: number } => d.average !== null,
  );
  if (scored.length === 0) return null;
  return scored.reduce((sum, d) => sum + d.average, 0) / scored.length;
}
