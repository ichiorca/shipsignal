// Frontend audit — pure provenance/trust rollup for the lineage view. The claim→evidence
// provenance was computed by the worker and exported as JSON, but the only on-screen surface was
// the claim-list inspector; there was no trust-at-a-glance summary. This derives that summary from
// the claim views. Kept free of any `server-only`/`pg` import (mirrors cost.ts / evalMetrics.ts)
// so the component and its `node --test` a11y harness can use it without the Aurora client.
//
// constitution §5: operates only on already-redacted claim/evidence views — no raw text.

import type { ArtifactClaimView } from '@/app/lib/db/claims.ts';

export interface ProvenanceSummary {
  readonly totalClaims: number;
  /** Claims with support_status === 'supported'. */
  readonly supported: number;
  /** Claims with support_status !== 'supported'. */
  readonly unsupported: number;
  /** Claims that link to at least one evidence item (the trust numerator). */
  readonly evidenceLinked: number;
  /** Claims flagged risk_level === 'high'. */
  readonly highRisk: number;
  /** Total distinct evidence links across all claims. */
  readonly evidenceLinks: number;
  /** evidenceLinked / totalClaims as a 0..1 ratio (0 when there are no claims). */
  readonly trustRatio: number;
}

/** Roll a set of claim views up into the trust summary the lineage header renders. */
export function summarizeProvenance(
  claims: readonly ArtifactClaimView[],
): ProvenanceSummary {
  let supported = 0;
  let evidenceLinked = 0;
  let highRisk = 0;
  let evidenceLinks = 0;
  for (const claim of claims) {
    if (claim.support_status === 'supported') supported += 1;
    if (claim.risk_level === 'high') highRisk += 1;
    if (claim.evidence.length > 0) evidenceLinked += 1;
    evidenceLinks += claim.evidence.length;
  }
  const totalClaims = claims.length;
  return {
    totalClaims,
    supported,
    unsupported: totalClaims - supported,
    evidenceLinked,
    highRisk,
    evidenceLinks,
    trustRatio: totalClaims === 0 ? 0 : evidenceLinked / totalClaims,
  };
}

/** Highest support_score among a claim's evidence links (null when none) — the "strongest
 *  grounding" shown next to each claim in the lineage. */
export function strongestSupport(claim: ArtifactClaimView): number | null {
  let best: number | null = null;
  for (const ref of claim.evidence) {
    if (ref.support_score !== null && (best === null || ref.support_score > best)) {
      best = ref.support_score;
    }
  }
  return best;
}
