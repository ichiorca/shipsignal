// T5 (spec 006) / T4 (spec 007) — Gate #2 artifact-review UI (PRD §5.6, §13.1 artifact review
// + claim inspector). P6 (Quality bars / WCAG 2.2 AA): one labelled reviewer field; artifacts
// are grouped into a labelled <section> per artifact type (T4 multi-artifact review — blog,
// sales one-pager, social, demo script, audio digest), each artifact a headed <section> with
// per-claim support/risk exposed as TEXT (data-* + visible label, not colour alone); supporting
// evidence as a list; an accessible action group (Approve / Reject / Save edits) with real
// <button>s and a live-region status message. A blocked artifact is announced and its Approve
// button is disabled (the API also refuses it). The type label + grouping come from the shared
// app/lib/artifactTypes module. constitution §4/§5: only redacted claim/evidence data is shown.
//
// "use client": this is the interactive leaf (ux-react: mark stateful components and keep
// them small/leaf-level). It posts JSON to the §14.3/§14.1 routes; the reviewer identity is
// required before any decision so nothing is approved anonymously (no self-approval).
// Authored with React.createElement (not JSX) so it renders under the dependency-free
// `node --test` a11y harness, mirroring the other components.

'use client';

import { createElement, useState } from 'react';
import type { ReactElement } from 'react';
import type { ArtifactWithClaims, ArtifactClaimView } from '@/app/lib/db/claims.ts';
import { typeLabel, groupByType } from '../lib/artifactTypes.ts';

export interface ArtifactReviewProps {
  readonly releaseRunId: string;
  readonly threadId: string | null;
  readonly artifacts: readonly ArtifactWithClaims[];
}

type Decision = 'approved' | 'rejected' | 'edited';

/** An artifact is cleanly approvable only if it is not blocked and every claim is supported
 *  with >=1 evidence link (mirrors the server-side isApprovable; the API is the source of
 *  truth, this just drives the disabled state). */
function approvable(artifact: ArtifactWithClaims): boolean {
  if (artifact.status === 'blocked') return false;
  return artifact.claims.every(
    (c) => c.support_status === 'supported' && c.evidence.length > 0,
  );
}

function evidenceList(claim: ArtifactClaimView): ReactElement {
  if (claim.evidence.length === 0) {
    return createElement('p', null, 'No linked evidence.');
  }
  return createElement(
    'ul',
    null,
    ...claim.evidence.map((ev) =>
      createElement(
        'li',
        { key: ev.evidence_item_id },
        createElement(
          'span',
          { 'data-evidence-type': ev.evidence_type },
          `${ev.evidence_type}: `,
        ),
        ev.redacted_excerpt,
      ),
    ),
  );
}

function claimItem(claim: ArtifactClaimView): ReactElement {
  const headingId = `claim-${claim.id}`;
  return createElement(
    'li',
    { key: claim.id, 'data-claim-id': claim.id, 'aria-labelledby': headingId },
    createElement('p', { id: headingId }, claim.claim_text),
    // Support + risk as TEXT, never colour alone (WCAG 2.2 AA). data-* drives tests/e2e.
    createElement(
      'dl',
      null,
      createElement('dt', { key: 'tt' }, 'Type'),
      createElement('dd', { key: 'td' }, claim.claim_type),
      createElement('dt', { key: 'st' }, 'Support'),
      createElement(
        'dd',
        { key: 'sd', 'data-support': claim.support_status },
        claim.support_status,
      ),
      createElement('dt', { key: 'rt' }, 'Risk'),
      createElement('dd', { key: 'rd', 'data-risk': claim.risk_level }, claim.risk_level),
    ),
    createElement('p', null, 'Supporting evidence'),
    evidenceList(claim),
  );
}

export function ArtifactReview({
  releaseRunId,
  threadId,
  artifacts,
}: ArtifactReviewProps): ReactElement {
  const [reviewer, setReviewer] = useState('');
  const [status, setStatus] = useState('');
  const [pending, setPending] = useState(false);

  async function decide(artifact: ArtifactWithClaims, decision: Decision): Promise<void> {
    if (reviewer.trim() === '') {
      setStatus('Enter your reviewer name before recording a decision.');
      return;
    }
    setPending(true);
    setStatus(`Recording ${decision} for "${artifact.title ?? typeLabel(artifact.artifact_type)}"…`);
    try {
      const isEdit = decision === 'edited';
      const action = decision === 'approved' ? 'approve' : 'reject';
      const url = `/api/artifacts/${artifact.id}${isEdit ? '' : `/${action}`}`;
      const response = await fetch(url, {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          isEdit
            ? { reviewer, edits: { body_markdown: artifact.body_markdown ?? '' } }
            : { reviewer },
        ),
      });
      if (response.ok) {
        setStatus(`Recorded ${decision} for "${artifact.title ?? typeLabel(artifact.artifact_type)}".`);
      } else if (response.status === 409) {
        setStatus(
          `Cannot approve "${artifact.title ?? typeLabel(artifact.artifact_type)}": it is blocked or has unsupported claims.`,
        );
      } else {
        setStatus(`Failed to record ${decision} (status ${response.status}).`);
      }
    } catch {
      setStatus(`Failed to record ${decision}.`);
    } finally {
      setPending(false);
    }
  }

  async function submitReview(decision: Decision): Promise<void> {
    if (reviewer.trim() === '') {
      setStatus('Enter your reviewer name before submitting the review.');
      return;
    }
    if (threadId === null) {
      setStatus('This run has no thread to resume yet.');
      return;
    }
    setPending(true);
    try {
      const response = await fetch(`/api/releases/${releaseRunId}/resume-artifacts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewer, decision, thread_id: threadId }),
      });
      setStatus(
        response.ok
          ? 'Artifact review submitted; the run is resuming.'
          : `Failed to submit review (status ${response.status}).`,
      );
    } catch {
      setStatus('Failed to submit the artifact review.');
    } finally {
      setPending(false);
    }
  }

  function artifactSection(artifact: ArtifactWithClaims): ReactElement {
    const headingId = `artifact-${artifact.id}`;
    const canApprove = approvable(artifact);
    const blocked = artifact.status === 'blocked';
    return createElement(
      'section',
      {
        key: artifact.id,
        'aria-labelledby': headingId,
        'data-artifact-id': artifact.id,
        'data-artifact-status': artifact.status,
      },
      createElement(
        'h3',
        { id: headingId },
        artifact.title ?? typeLabel(artifact.artifact_type),
      ),
      createElement('p', { 'data-status': artifact.status }, `Status: ${artifact.status}`),
      blocked
        ? createElement(
            'p',
            { role: 'alert' },
            'This artifact was blocked by a check (unsupported claim, fabricated metric, ' +
              'leaked secret, or Guardrail). It cannot be approved — reject or edit it.',
          )
        : null,
      createElement('h4', null, 'Claims'),
      artifact.claims.length === 0
        ? createElement('p', null, 'No claims were extracted for this artifact.')
        : createElement('ul', null, ...artifact.claims.map(claimItem)),
      createElement(
        'div',
        {
          role: 'group',
          'aria-label': `Decision for ${artifact.title ?? typeLabel(artifact.artifact_type)}`,
        },
        createElement(
          'button',
          {
            type: 'button',
            disabled: pending || !canApprove,
            'aria-disabled': pending || !canApprove,
            onClick: () => decide(artifact, 'approved'),
          },
          'Approve',
        ),
        createElement(
          'button',
          { type: 'button', disabled: pending, onClick: () => decide(artifact, 'rejected') },
          'Reject',
        ),
        createElement(
          'button',
          { type: 'button', disabled: pending, onClick: () => decide(artifact, 'edited') },
          'Save edits',
        ),
      ),
    );
  }

  // T4 (spec 007): group artifacts into a labelled <section> per artifact type so a reviewer
  // can scan the multi-artifact set by type (blog, sales one-pager, demo script, …). Each
  // group is a region named by its <h2>; the artifact subsections keep their <h3> heading and
  // data-* hooks, so the per-artifact controls and the e2e/a11y selectors are unchanged.
  function typeGroupSection(group: {
    readonly type: string;
    readonly items: readonly ArtifactWithClaims[];
  }): ReactElement {
    const groupHeadingId = `artifact-type-${group.type}`;
    const label = typeLabel(group.type);
    return createElement(
      'section',
      {
        key: group.type,
        'aria-labelledby': groupHeadingId,
        'data-artifact-type-group': group.type,
      },
      createElement(
        'h2',
        { id: groupHeadingId },
        `${label} (${group.items.length})`,
      ),
      ...group.items.map(artifactSection),
    );
  }

  if (artifacts.length === 0) {
    return createElement(
      'div',
      null,
      createElement('p', null, 'No artifacts are pending review for this run.'),
    );
  }

  const groups = groupByType(artifacts, (a) => a.artifact_type);

  return createElement(
    'div',
    null,
    createElement(
      'p',
      null,
      createElement('label', { htmlFor: 'reviewer' }, 'Reviewer name'),
    ),
    createElement('input', {
      id: 'reviewer',
      name: 'reviewer',
      type: 'text',
      value: reviewer,
      autoComplete: 'name',
      onChange: (e: { target: { value: string } }) => setReviewer(e.target.value),
    }),
    createElement('p', { role: 'status', 'aria-live': 'polite' }, status),
    ...groups.map(typeGroupSection),
    createElement(
      'div',
      { role: 'group', 'aria-label': 'Submit artifact review' },
      createElement(
        'button',
        { type: 'button', disabled: pending, onClick: () => submitReview('approved') },
        'Submit & resume',
      ),
    ),
  );
}
