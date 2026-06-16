// Frontend audit — provenance/lineage view. The evidence→claim→artifact trust story was computed
// by the worker (support scores) and exported as JSON, but on-screen it only appeared as a flat
// claim list (ClaimInspector). This is the trust-first lens: a rollup header ("N of M claims
// evidence-linked", supported / unsupported / high-risk) followed by the artifact → claim →
// evidence lineage chain, with each claim's strongest grounding score surfaced.
//
// P6 (WCAG 2.2 AA): the rollup is a <dl> so each figure has a programmatic label; each claim is a
// headed <section>; support status, risk, and scores render as TEXT (data-attributes add colour as
// an enhancement, never the sole signal); the trust bar reuses the aria-hidden MiniBar. §5: built
// from REDACTED claim/evidence views — no raw text.
//
// Authored with React.createElement so it renders under the dependency-free `node --test` harness.

import { createElement } from 'react';
import type { ReactElement } from 'react';
import type {
  ArtifactWithClaims,
  ArtifactClaimView,
  ClaimEvidenceRef,
} from '@/app/lib/db/claims.ts';
import type { ProvenanceSummary } from '@/app/lib/provenanceView.ts';
import { strongestSupport } from '../lib/provenanceView.ts';
import { MiniBar } from './MiniBar.ts';
import { EMPTY, humanizeStatus } from '../lib/displayFormat.ts';

export interface ProvenanceLineageProps {
  readonly artifact: ArtifactWithClaims;
  readonly summary: ProvenanceSummary;
}

function pct(ratio: number): string {
  return `${(ratio * 100).toFixed(0)}%`;
}

function rollup(summary: ProvenanceSummary): ReactElement {
  const stats: ReadonlyArray<{ key: string; label: string; value: string }> = [
    { key: 'linked', label: 'Claims evidence-linked', value: `${summary.evidenceLinked} / ${summary.totalClaims}` },
    { key: 'supported', label: 'Supported', value: String(summary.supported) },
    { key: 'unsupported', label: 'Unsupported', value: String(summary.unsupported) },
    { key: 'highRisk', label: 'High-risk claims', value: String(summary.highRisk) },
    { key: 'links', label: 'Evidence links', value: String(summary.evidenceLinks) },
  ];
  return createElement(
    'div',
    null,
    createElement(
      'p',
      { 'data-trust-headline': true },
      `${pct(summary.trustRatio)} of claims are evidence-linked`,
      // Decorative proportional bar; the ratio text above is the accessible carrier.
      createElement(MiniBar, { value: summary.trustRatio, max: 1 }),
    ),
    createElement(
      'dl',
      { 'data-hero-stats': true },
      ...stats.map((s) =>
        createElement(
          'div',
          { key: s.key, 'data-provenance-stat': s.key },
          createElement('dt', null, s.label),
          createElement('dd', null, createElement('span', { 'data-stat-value': true }, s.value)),
        ),
      ),
    ),
  );
}

function evidenceItem(ref: ClaimEvidenceRef): ReactElement {
  const score = ref.support_score === null ? EMPTY : ref.support_score.toFixed(2);
  return createElement(
    'li',
    { key: ref.evidence_item_id, 'data-evidence-id': ref.evidence_item_id },
    createElement('span', { 'data-evidence-type': ref.evidence_type }, `${ref.evidence_type}: `),
    createElement('span', null, ref.redacted_excerpt === '' ? '(no excerpt)' : ref.redacted_excerpt),
    createElement('span', { 'data-support-score': score }, ` (support ${score})`),
  );
}

function claimLineage(claim: ArtifactClaimView, index: number): ReactElement {
  const headingId = `lineage-claim-${claim.id}`;
  const best = strongestSupport(claim);
  const linked = claim.evidence.length > 0;
  return createElement(
    'section',
    {
      key: claim.id,
      'aria-labelledby': headingId,
      'data-claim-id': claim.id,
      'data-support-status': claim.support_status,
      'data-risk-level': claim.risk_level,
    },
    createElement('h3', { id: headingId }, `Claim ${index + 1}`),
    createElement('p', null, claim.claim_text),
    createElement(
      'dl',
      null,
      createElement('dt', { key: 'st' }, 'Support'),
      createElement(
        'dd',
        { key: 'sd', 'data-support-status': claim.support_status },
        humanizeStatus(claim.support_status),
      ),
      createElement('dt', { key: 'rt' }, 'Risk'),
      createElement('dd', { key: 'rd', 'data-risk-level': claim.risk_level }, humanizeStatus(claim.risk_level)),
      createElement('dt', { key: 'gt' }, 'Strongest grounding'),
      createElement('dd', { key: 'gd', 'data-strongest-support': best === null ? 'none' : best.toFixed(2) },
        best === null ? EMPTY : best.toFixed(2)),
    ),
    createElement('h4', null, `Evidence (${claim.evidence.length})`),
    linked
      ? createElement('ul', null, ...claim.evidence.map(evidenceItem))
      : createElement(
          'p',
          { 'data-evidence': 'none' },
          'No supporting evidence linked — this claim is not grounded.',
        ),
  );
}

export function ProvenanceLineage({ artifact, summary }: ProvenanceLineageProps): ReactElement {
  return createElement(
    'div',
    { 'data-provenance-lineage': true, 'data-artifact-id': artifact.id },
    createElement(
      'section',
      { 'aria-labelledby': 'trust-rollup-heading' },
      createElement('h2', { id: 'trust-rollup-heading' }, 'Trust summary'),
      rollup(summary),
    ),
    createElement(
      'section',
      { 'aria-labelledby': 'lineage-heading' },
      createElement('h2', { id: 'lineage-heading' }, 'Claim → evidence lineage'),
      artifact.claims.length === 0
        ? createElement('p', null, 'This artifact has no extracted claims to trace.')
        : createElement('div', null, ...artifact.claims.map(claimLineage)),
    ),
  );
}
