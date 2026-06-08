// T5 (spec 015) — standalone Claim-inspector screen (PRD §13.1): for one artifact, shows
// each claim with its support status, risk flags, and the evidence it links to. P6
// (Quality bars / WCAG 2.2 AA): each claim is a headed <section> (aria-labelledby its
// heading); support status + risk level are rendered as TEXT (data-attributes are
// enhancement only, never colour alone); the evidence links are a semantic list.
// constitution §5: claims + evidence are built from REDACTED evidence, so the component —
// typed against `ArtifactWithClaims` — renders no raw text.
//
// Purely presentational (no hooks/state) and authored with React.createElement so it
// renders under the dependency-free `node --test` a11y harness, mirroring EvidenceTable.

import { createElement } from 'react';
import type { ReactElement } from 'react';
import type {
  ArtifactWithClaims,
  ArtifactClaimView,
  ClaimEvidenceRef,
} from '@/app/lib/db/claims.ts';

export interface ClaimInspectorProps {
  readonly artifact: ArtifactWithClaims;
}

function evidenceItem(ref: ClaimEvidenceRef): ReactElement {
  const score = ref.support_score === null ? 'n/a' : ref.support_score.toFixed(2);
  return createElement(
    'li',
    { key: ref.evidence_item_id, 'data-evidence-id': ref.evidence_item_id },
    createElement('span', { 'data-evidence-type': ref.evidence_type }, `${ref.evidence_type}: `),
    createElement('span', null, ref.redacted_excerpt === '' ? '(no excerpt)' : ref.redacted_excerpt),
    createElement('span', { 'data-support-score': score }, ` (support ${score})`),
  );
}

function evidenceList(evidence: readonly ClaimEvidenceRef[]): ReactElement {
  if (evidence.length === 0) {
    // An unsupported claim links to no evidence — state that explicitly (constitution §5).
    return createElement('p', { 'data-evidence': 'none' }, 'No supporting evidence linked.');
  }
  return createElement('ul', null, ...evidence.map(evidenceItem));
}

function claimSection(claim: ArtifactClaimView, index: number): ReactElement {
  const headingId = `claim-${claim.id}`;
  return createElement(
    'section',
    {
      key: claim.id,
      'aria-labelledby': headingId,
      'data-claim-id': claim.id,
      'data-support-status': claim.support_status,
      'data-risk-level': claim.risk_level,
    },
    createElement('h2', { id: headingId }, `Claim ${index + 1}`),
    createElement('p', null, claim.claim_text),
    // Support status + risk + type as readable text (PRD §13.1 / §8.3), not colour alone.
    createElement(
      'dl',
      null,
      createElement('dt', { key: 'tt' }, 'Type'),
      createElement('dd', { key: 'td' }, claim.claim_type),
      createElement('dt', { key: 'st' }, 'Support status'),
      createElement('dd', { key: 'sd', 'data-support-status': claim.support_status }, claim.support_status),
      createElement('dt', { key: 'rt' }, 'Risk level'),
      createElement('dd', { key: 'rd', 'data-risk-level': claim.risk_level }, claim.risk_level),
    ),
    createElement('h3', null, 'Evidence'),
    evidenceList(claim.evidence),
  );
}

export function ClaimInspector({ artifact }: ClaimInspectorProps): ReactElement {
  return createElement(
    'div',
    { 'data-artifact-id': artifact.id, 'data-artifact-status': artifact.status },
    createElement(
      'dl',
      null,
      createElement('dt', { key: 'tyt' }, 'Artifact type'),
      createElement('dd', { key: 'tyd' }, artifact.artifact_type),
      createElement('dt', { key: 'stt' }, 'Status'),
      createElement('dd', { key: 'std', 'data-artifact-status': artifact.status }, artifact.status),
    ),
    artifact.claims.length === 0
      ? createElement('p', null, 'This artifact has no extracted claims.')
      : createElement(
          'div',
          null,
          ...artifact.claims.map((claim, index) => claimSection(claim, index)),
        ),
  );
}
