// T5 (spec 006) / T4 (spec 007) — Gate #2 artifact-review UI (PRD §5.6, §13.1 artifact review
// + claim inspector). P6 (Quality bars / WCAG 2.2 AA): one labelled reviewer field; artifacts
// grouped into a labelled <section> per artifact type, each artifact a headed <section> with
// per-claim support/risk exposed as TEXT (data-* + visible label, not colour alone); supporting
// evidence as a list; an accessible action group (Approve / Reject / Save edits) with real
// <button>s and a live-region status message. A blocked artifact is announced and its Approve
// button is disabled (the API also refuses it).
//
// "Save edits" edits a REAL, labelled <textarea> of the artifact body and sends its value
// (previously it re-sent the unchanged body, a no-op that reported success — UX review H4).
// The run-level gate decision is EXPLICIT (Approve OR Reject & resume) behind a confirmation
// dialog (UX review B2/B1). The reviewer name is required (focus + aria-invalid on omission,
// UX H5) and persisted across gates (L3). constitution §4/§5: only redacted claim/evidence
// data is shown; nothing is approved anonymously (no self-approval).
//
// Authored with React.createElement (not JSX) so it renders under the dependency-free
// `node --test` a11y harness, mirroring the other components.

'use client';

import { createElement, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { clientFetch } from '../lib/clientFetch.ts';
import type { ArtifactWithClaims, ArtifactClaimView } from '@/app/lib/db/claims.ts';
import type { ScheduledPublishView } from '../lib/scheduledPublish.ts';
import { typeLabel, groupByType } from '../lib/artifactTypes.ts';
import { ArtifactExportActions } from './ArtifactExportActions.ts';
import { SchedulePublish } from './SchedulePublish.ts';
import { ConfirmButton } from './ConfirmButton.ts';
import { useReviewerName } from '../lib/useReviewerName.ts';

export interface ArtifactReviewProps {
  readonly releaseRunId: string;
  readonly threadId: string | null;
  readonly artifacts: readonly ArtifactWithClaims[];
  /** Phase 4 — approve-then-schedule context (optional; defaults to scheduling-off). */
  readonly schedulingEnabled?: boolean;
  readonly suggestedTimeIso?: string;
  readonly schedulesByArtifact?: Readonly<Record<string, readonly ScheduledPublishView[]>>;
}

type Decision = 'approved' | 'rejected' | 'edited';

/** User-facing message for a failed request — never expose a bare HTTP status (UX review H5). */
function failureMessage(status: number): string {
  if (status === 409) return 'it is blocked or has unsupported claims and cannot be approved.';
  if (status >= 500) return 'the server hit an error — please try again.';
  return `the request was rejected (code ${status}).`;
}

/** An artifact is cleanly approvable only if it is not blocked and every claim is supported
 *  with >=1 evidence link (mirrors the server-side isApprovable; the API is the source of
 *  truth, this just drives the disabled state). */
function approvable(artifact: ArtifactWithClaims): boolean {
  // Mirrors the server-side isApprovable: a blocked or not-yet-re-validated edited artifact
  // is never directly approvable (constitution §5).
  if (artifact.status === 'blocked' || artifact.status === 'edited') return false;
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
  schedulingEnabled = false,
  suggestedTimeIso = '',
  schedulesByArtifact = {},
}: ArtifactReviewProps): ReactElement {
  const [reviewer, setReviewer] = useReviewerName();
  const [reviewerError, setReviewerError] = useState(false);
  const [edits, setEdits] = useState<Readonly<Record<string, string>>>({});
  const [status, setStatus] = useState('');
  const [pending, setPending] = useState(false);
  const reviewerRef = useRef<HTMLInputElement | null>(null);

  const noReviewer = reviewer.trim() === '';

  function requireReviewer(): boolean {
    if (noReviewer) {
      setReviewerError(true);
      reviewerRef.current?.focus();
      setStatus('Enter your reviewer name before recording a decision.');
      return false;
    }
    setReviewerError(false);
    return true;
  }

  async function decide(artifact: ArtifactWithClaims, decision: Decision): Promise<void> {
    if (!requireReviewer()) return;
    const name = artifact.title ?? typeLabel(artifact.artifact_type);
    setPending(true);
    setStatus(`Recording ${decision} for "${name}"…`);
    try {
      const isEdit = decision === 'edited';
      const action = decision === 'approved' ? 'approve' : 'reject';
      const url = `/api/artifacts/${artifact.id}${isEdit ? '' : `/${action}`}`;
      const response = await clientFetch(url, {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          isEdit
            ? { reviewer, edits: { body_markdown: edits[artifact.id] ?? artifact.body_markdown ?? '' } }
            : { reviewer },
        ),
      });
      setStatus(
        response.ok
          ? `Recorded ${decision} for "${name}".`
          : `Could not record ${decision} for "${name}": ${failureMessage(response.status)}`,
      );
    } catch {
      setStatus(`Could not record ${decision} for "${name}" — the request did not complete.`);
    } finally {
      setPending(false);
    }
  }

  async function submitReview(decision: Decision): Promise<void> {
    if (threadId === null) {
      setStatus('This run has no thread to resume yet.');
      return;
    }
    setPending(true);
    setStatus(`Submitting the artifact review as ${decision}; the run is resuming…`);
    try {
      const response = await clientFetch(`/api/releases/${releaseRunId}/resume-artifacts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewer, decision, thread_id: threadId }),
      });
      setStatus(
        response.ok
          ? `Artifact review ${decision}; the run is resuming.`
          : `Could not submit the review: ${failureMessage(response.status)}`,
      );
    } catch {
      setStatus('Could not submit the artifact review — the request did not complete.');
    } finally {
      setPending(false);
    }
  }

  function artifactSection(artifact: ArtifactWithClaims): ReactElement {
    const headingId = `artifact-${artifact.id}`;
    const editId = `edit-${artifact.id}`;
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
      // A real, labelled editor so "Save edits" sends the reviewer's changes (UX review H4).
      createElement(
        'p',
        null,
        createElement('label', { htmlFor: editId }, 'Edit artifact body (Markdown)'),
      ),
      createElement('textarea', {
        id: editId,
        value: edits[artifact.id] ?? artifact.body_markdown ?? '',
        onChange: (e: { target: { value: string } }) =>
          setEdits((prev) => ({ ...prev, [artifact.id]: e.target.value })),
      }),
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
      // T2 (spec 019) — an APPROVED artifact gains export actions (copy/download of the
      // immutable Gate #2 snapshot, §18.1). Pre-decision artifacts have nothing exportable.
      artifact.status === 'approved'
        ? createElement(ArtifactExportActions, {
            artifactId: artifact.id,
            artifactLabel: artifact.title ?? typeLabel(artifact.artifact_type),
            // Publish destinations (operator feedback 2026-06-09): type gates the GitHub
            // Release button; the reviewer name flows into the publish audit log.
            artifactType: artifact.artifact_type,
            reviewer,
          })
        : null,
      // Phase 4 — schedule an approved post inline from the Gate #2 surface (renders nothing for a
      // non-schedulable type, or a hint when PUBLISH_MODE isn't 'scheduled').
      artifact.status === 'approved'
        ? createElement(SchedulePublish, {
            artifactId: artifact.id,
            artifactType: artifact.artifact_type,
            schedulingEnabled,
            suggestedTimeIso,
            schedules: schedulesByArtifact[artifact.id] ?? [],
          })
        : null,
    );
  }

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
      createElement('h2', { id: groupHeadingId }, `${label} (${group.items.length})`),
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
      createElement('label', { htmlFor: 'reviewer' }, 'Reviewer name (required)'),
    ),
    createElement('input', {
      id: 'reviewer',
      name: 'reviewer',
      type: 'text',
      value: reviewer,
      required: true,
      autoComplete: 'name',
      ref: reviewerRef,
      'aria-invalid': reviewerError,
      'aria-describedby': reviewerError ? 'reviewer-error' : undefined,
      onChange: (e: { target: { value: string } }) => {
        setReviewer(e.target.value);
        if (e.target.value.trim() !== '') setReviewerError(false);
      },
    }),
    reviewerError
      ? createElement('p', { id: 'reviewer-error', role: 'alert' }, 'Enter your reviewer name to record a decision.')
      : null,
    createElement('p', { role: 'status', 'aria-live': 'polite' }, status),
    ...groups.map(typeGroupSection),
    createElement(
      'div',
      { role: 'group', 'aria-label': 'Submit artifact review (Gate #2)' },
      noReviewer
        ? createElement('p', null, 'Enter your reviewer name above to record a gate decision.')
        : null,
      createElement(ConfirmButton, {
        label: 'Approve & resume',
        title: 'Approve the artifacts and resume?',
        body:
          'This records your approval and resumes the worker past Gate #2 so the approved ' +
          'artifacts can publish and optional media can generate. It cannot be undone from here.',
        confirmLabel: 'Approve & resume',
        disabled: pending || noReviewer || threadId === null,
        onConfirm: () => submitReview('approved'),
      }),
      createElement(ConfirmButton, {
        label: 'Reject & resume',
        title: 'Reject the artifacts and resume?',
        body:
          'This records a rejection and resumes the worker past Gate #2. The artifacts will ' +
          'not publish. It cannot be undone from here.',
        confirmLabel: 'Reject & resume',
        disabled: pending || noReviewer || threadId === null,
        onConfirm: () => submitReview('rejected'),
      }),
    ),
  );
}
