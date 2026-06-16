// T5/T6 (spec 004) — Gate #1 feature-manifest review UI (PRD §5.6, §13.1).
// P6 (Quality bars / WCAG 2.2 AA): one labelled reviewer field, each feature in a
// <section> with a heading and a <dl> of scores, supporting evidence as a list, and an
// accessible action group (Approve / Reject / Save edits) with real <button>s and a
// live-region status message. constitution §4/§5: only redacted manifest data is shown.
//
// The run-level gate decision is EXPLICIT (Approve OR Reject manifest & resume) and runs
// behind a confirmation dialog, because resuming the worker past Gate #1 is consequential
// and was previously a single hardcoded "approved" click (UX review B2/B1). The reviewer
// name is required (focus + aria-invalid on omission, UX H5) and persisted across gates (L3).
//
// "use client": this is the interactive leaf (ux-react). It posts JSON to the §14.2/§14.1
// routes; the reviewer identity is required before any decision so nothing is approved
// anonymously (no self-approval). Authored with React.createElement (not JSX) so it renders
// under the dependency-free `node --test` a11y harness, mirroring the other components.

'use client';

import { createElement, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { clientFetch } from '../lib/clientFetch.ts';
import type { FeatureCluster } from '@/app/lib/db/features.ts';
import { ConfirmButton } from './ConfirmButton.ts';
import { useReviewerName } from '../lib/useReviewerName.ts';

export interface FeatureManifestReviewProps {
  readonly releaseRunId: string;
  readonly threadId: string | null;
  readonly features: readonly FeatureCluster[];
}

type Decision = 'approved' | 'rejected' | 'edited';

/** User-facing message for a failed request — never expose a bare HTTP status (UX review H5). */
function failureMessage(status: number): string {
  if (status === 409) return 'it conflicts with the current state (already decided or blocked).';
  if (status >= 500) return 'the server hit an error — please try again.';
  return `the request was rejected (code ${status}).`;
}

function score(label: string, value: number | null): ReactElement {
  const text = value === null ? '—' : value.toFixed(2);
  return createElement(
    'div',
    { key: label },
    createElement('dt', null, label),
    createElement('dd', null, text),
  );
}

function evidenceList(feature: FeatureCluster): ReactElement {
  if (feature.evidence.length === 0) {
    return createElement('p', null, 'No linked evidence.');
  }
  return createElement(
    'ul',
    null,
    ...feature.evidence.map((ev) =>
      createElement(
        'li',
        { key: ev.evidence_item_id },
        createElement('span', { 'data-evidence-type': ev.evidence_type }, `${ev.evidence_type}: `),
        ev.redacted_excerpt,
      ),
    ),
  );
}

export function FeatureManifestReview({
  releaseRunId,
  threadId,
  features,
}: FeatureManifestReviewProps): ReactElement {
  const [reviewer, setReviewer] = useReviewerName();
  const [reviewerError, setReviewerError] = useState(false);
  const [edits, setEdits] = useState<Readonly<Record<string, string>>>({});
  const [status, setStatus] = useState('');
  const [pending, setPending] = useState(false);
  const reviewerRef = useRef<HTMLInputElement | null>(null);

  const noReviewer = reviewer.trim() === '';

  /** Validate the reviewer name for a per-feature action; on omission, mark the field
   *  invalid and move focus to it (UX review H5) rather than only writing to the status. */
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

  async function decide(feature: FeatureCluster, decision: Decision): Promise<void> {
    if (!requireReviewer()) return;
    setPending(true);
    setStatus(`Recording ${decision} for "${feature.title}"…`);
    try {
      const editedValue = edits[feature.id];
      const isEdit = decision === 'edited';
      const url = `/api/features/${feature.id}${isEdit ? '' : `/${decision === 'approved' ? 'approve' : 'reject'}`}`;
      const response = await clientFetch(url, {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          isEdit
            ? { reviewer, edits: { user_value: editedValue ?? feature.user_value ?? '' } }
            : { reviewer },
        ),
      });
      setStatus(
        response.ok
          ? `Recorded ${decision} for "${feature.title}".`
          : `Could not record ${decision}: ${failureMessage(response.status)}`,
      );
    } catch {
      setStatus(`Could not record ${decision} for "${feature.title}" — the request did not complete.`);
    } finally {
      setPending(false);
    }
  }

  async function submitManifest(decision: Decision): Promise<void> {
    if (threadId === null) {
      setStatus('This run has no thread to resume yet.');
      return;
    }
    setPending(true);
    setStatus(`Submitting the manifest as ${decision}; the run is resuming…`);
    try {
      const response = await clientFetch(`/api/releases/${releaseRunId}/resume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewer, decision, thread_id: threadId }),
      });
      setStatus(
        response.ok
          ? `Manifest ${decision}; the run is resuming.`
          : `Could not submit the manifest: ${failureMessage(response.status)}`,
      );
    } catch {
      setStatus('Could not submit the manifest review — the request did not complete.');
    } finally {
      setPending(false);
    }
  }

  function featureSection(feature: FeatureCluster): ReactElement {
    const headingId = `feature-${feature.id}`;
    const editId = `edit-${feature.id}`;
    return createElement(
      'section',
      { key: feature.id, 'aria-labelledby': headingId, 'data-feature-id': feature.id },
      createElement('h2', { id: headingId }, feature.title),
      createElement('p', { 'data-status': feature.status }, `Status: ${feature.status}`),
      feature.user_value ? createElement('p', null, feature.user_value) : null,
      createElement(
        'dl',
        null,
        score('Marketability', feature.marketability_score),
        score('Demoability', feature.demoability_score),
        score('Confidence', feature.confidence),
      ),
      createElement('h3', null, 'Supporting evidence'),
      evidenceList(feature),
      createElement(
        'p',
        null,
        createElement('label', { htmlFor: editId }, 'Edit user value'),
      ),
      createElement('textarea', {
        id: editId,
        value: edits[feature.id] ?? feature.user_value ?? '',
        onChange: (e: { target: { value: string } }) =>
          setEdits((prev) => ({ ...prev, [feature.id]: e.target.value })),
      }),
      createElement(
        'div',
        { role: 'group', 'aria-label': `Decision for ${feature.title}` },
        createElement(
          'button',
          { type: 'button', disabled: pending, onClick: () => decide(feature, 'approved') },
          'Approve',
        ),
        createElement(
          'button',
          { type: 'button', disabled: pending, onClick: () => decide(feature, 'rejected') },
          'Reject',
        ),
        createElement(
          'button',
          { type: 'button', disabled: pending, onClick: () => decide(feature, 'edited') },
          'Save edits',
        ),
      ),
    );
  }

  if (features.length === 0) {
    return createElement(
      'div',
      null,
      createElement('p', null, 'No features are pending review for this run.'),
    );
  }

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
    ...features.map(featureSection),
    createElement(
      'div',
      { role: 'group', 'aria-label': 'Submit manifest review (Gate #1)' },
      noReviewer
        ? createElement('p', null, 'Enter your reviewer name above to record a gate decision.')
        : null,
      createElement(ConfirmButton, {
        label: 'Approve manifest & resume',
        title: 'Approve the feature manifest?',
        body:
          'This records your approval and resumes the worker past Gate #1 to generate ' +
          'content from the approved features. It cannot be undone from here.',
        confirmLabel: 'Approve & resume',
        testId: 'manifest-approve',
        disabled: pending || noReviewer || threadId === null,
        onConfirm: () => submitManifest('approved'),
      }),
      createElement(ConfirmButton, {
        label: 'Reject manifest & resume',
        title: 'Reject the feature manifest?',
        body:
          'This records a rejection and resumes the worker past Gate #1. No content will ' +
          'be generated for this manifest. It cannot be undone from here.',
        confirmLabel: 'Reject & resume',
        testId: 'manifest-reject',
        disabled: pending || noReviewer || threadId === null,
        onConfirm: () => submitManifest('rejected'),
      }),
    ),
  );
}
