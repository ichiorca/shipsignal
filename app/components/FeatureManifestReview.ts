// T5/T6 (spec 004) — Gate #1 feature-manifest review UI (PRD §5.6, §13.1).
// P6 (Quality bars / WCAG 2.2 AA): one labelled reviewer field, each feature in a
// <section> with a heading and a <dl> of scores, supporting evidence as a list, and an
// accessible action group (Approve / Reject / Save edits) with real <button>s and a
// live-region status message. constitution §4/§5: only redacted manifest data is shown.
//
// "use client": this is the interactive leaf (ux-react: mark stateful components and keep
// them small/leaf-level). It posts JSON to the §14.2/§14.1 routes; the reviewer identity
// is required before any decision so nothing is approved anonymously (no self-approval).
// Authored with React.createElement (not JSX) so it renders under the dependency-free
// `node --test` a11y harness, mirroring the other components.

'use client';

import { createElement, useState } from 'react';
import type { ReactElement } from 'react';
import type { FeatureCluster } from '@/app/lib/db/features.ts';

export interface FeatureManifestReviewProps {
  readonly releaseRunId: string;
  readonly threadId: string | null;
  readonly features: readonly FeatureCluster[];
}

type Decision = 'approved' | 'rejected' | 'edited';

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
  const [reviewer, setReviewer] = useState('');
  const [edits, setEdits] = useState<Readonly<Record<string, string>>>({});
  const [status, setStatus] = useState('');
  const [pending, setPending] = useState(false);

  async function decide(feature: FeatureCluster, decision: Decision): Promise<void> {
    if (reviewer.trim() === '') {
      setStatus('Enter your reviewer name before recording a decision.');
      return;
    }
    setPending(true);
    setStatus(`Recording ${decision} for "${feature.title}"…`);
    try {
      const editedValue = edits[feature.id];
      const isEdit = decision === 'edited';
      const url = `/api/features/${feature.id}${isEdit ? '' : `/${decision === 'approved' ? 'approve' : 'reject'}`}`;
      const response = await fetch(url, {
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
          : `Failed to record ${decision} (status ${response.status}).`,
      );
    } catch {
      setStatus(`Failed to record ${decision} for "${feature.title}".`);
    } finally {
      setPending(false);
    }
  }

  async function submitManifest(decision: Decision): Promise<void> {
    if (reviewer.trim() === '') {
      setStatus('Enter your reviewer name before submitting the manifest.');
      return;
    }
    if (threadId === null) {
      setStatus('This run has no thread to resume yet.');
      return;
    }
    setPending(true);
    try {
      const response = await fetch(`/api/releases/${releaseRunId}/resume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewer, decision, thread_id: threadId }),
      });
      setStatus(
        response.ok
          ? 'Manifest review submitted; the run is resuming.'
          : `Failed to submit manifest (status ${response.status}).`,
      );
    } catch {
      setStatus('Failed to submit the manifest review.');
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
    ...features.map(featureSection),
    createElement(
      'div',
      { role: 'group', 'aria-label': 'Submit manifest review' },
      createElement(
        'button',
        { type: 'button', disabled: pending, onClick: () => submitManifest('approved') },
        'Submit & resume',
      ),
    ),
  );
}
