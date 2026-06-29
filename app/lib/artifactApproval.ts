// The pure Gate #2 approval predicate, extracted from the server-only db/claims module so it
// is unit-testable on its own (node:test can't load claims.ts — it imports `server-only` + pg).
// This is a constitution §5 safety gate: an artifact may be approved ONLY if it passed the
// checks on its CURRENT body and every claim is grounded.

import type { ArtifactWithClaims } from '@/app/lib/db/claims.ts';

/** True when the artifact can be cleanly approved: not blocked, not awaiting re-validation
 *  after an edit, and it carries at least one claim, every one supported with >=1 evidence
 *  link (an unlinkable or unsupported claim is never approved, and a zero-claim artifact has
 *  no provenance at all). */
export function isApprovable(artifact: ArtifactWithClaims): boolean {
  // 'blocked' (a check tripped) and 'edited' (body changed, not yet re-validated by the worker
  // checks) are never directly approvable.
  if (artifact.status === 'blocked' || artifact.status === 'edited') return false;
  // `.every` is vacuously true on an empty array — an artifact whose claim extraction returned
  // no claims would otherwise pass Gate #2 with zero claim-level provenance (constitution §8).
  if (artifact.claims.length === 0) return false;
  return artifact.claims.every(
    (c) => c.support_status === 'supported' && c.evidence.length > 0,
  );
}

/** A scannable provenance summary for one artifact (UX review R5 — sell the trust story).
 *  `grounded` counts claims that are both supported and evidence-linked. `tone` drives the visual
 *  state purely from data (never colour alone — the caller renders `text` too):
 *    - 'none'   : no claims extracted (nothing tying the copy to evidence yet);
 *    - 'solid'  : every claim is grounded;
 *    - 'partial': at least one claim is unsupported or unlinked. */
export interface ProvenanceSummary {
  readonly total: number;
  readonly grounded: number;
  readonly tone: 'none' | 'solid' | 'partial';
  readonly text: string;
}

export function provenanceSummary(artifact: ArtifactWithClaims): ProvenanceSummary {
  const total = artifact.claims.length;
  const grounded = artifact.claims.filter(
    (c) => c.support_status === 'supported' && c.evidence.length > 0,
  ).length;
  if (total === 0) {
    return { total, grounded, tone: 'none', text: 'No claims extracted — no evidence to back yet' };
  }
  if (grounded === total) {
    return {
      total,
      grounded,
      tone: 'solid',
      text: `${total} ${total === 1 ? 'claim' : 'claims'} · all evidence-backed`,
    };
  }
  return {
    total,
    grounded,
    tone: 'partial',
    text: `${grounded} of ${total} claims evidence-backed · ${total - grounded} need attention`,
  };
}
