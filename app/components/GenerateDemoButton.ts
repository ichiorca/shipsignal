// T1 (spec 014) — the dashboard trigger for demo-media generation (PRD §14.5). The backend
// (POST /api/features/{featureId}/generate-demo → workflow_dispatch → media_generation graph →
// S3 → the demo-media preview page) existed end-to-end but had NO UI entry point: a reviewer
// could VIEW rendered media but never START a render from the dashboard. This island closes that
// gap on the demo-media page, per approved feature.
//
// Human-gated by construction (constitution §2/§5): generation is an accountable action, so the
// reviewer name is required and recorded in the approvals audit log by the route before any
// worker is dispatched. The button refuses politely (no dispatch) until a name is entered.
//
// Authored with React.createElement (not JSX) so it renders under the dependency-free
// `node --test` a11y harness, mirroring the other components.

'use client';

import { createElement, useState } from 'react';
import type { ReactElement } from 'react';
import { useReviewerName } from '../lib/useReviewerName.ts';

export interface GenerateDemoButtonProps {
  readonly featureId: string;
  /** Accessible label for the feature (its title). */
  readonly featureLabel: string;
}

export function GenerateDemoButton({
  featureId,
  featureLabel,
}: GenerateDemoButtonProps): ReactElement {
  const [reviewer, setReviewer] = useReviewerName();
  const [status, setStatus] = useState('');
  const [pending, setPending] = useState(false);

  async function generate(): Promise<void> {
    if (reviewer.trim() === '') {
      setStatus('Enter your reviewer name before generating demo media.');
      return;
    }
    setPending(true);
    setStatus(`Starting demo generation for "${featureLabel}"…`);
    try {
      const response = await fetch(`/api/features/${featureId}/generate-demo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewer: reviewer.trim() }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: unknown };
      if (response.ok) {
        // 202: the Actions job was dispatched; media appears on this page when it finishes.
        setStatus(
          `Demo generation started for "${featureLabel}". The media will appear here once the ` +
            'render finishes — refresh in a few minutes.',
        );
      } else {
        setStatus(
          typeof body.error === 'string'
            ? body.error
            : `Could not start demo generation (status ${response.status}).`,
        );
      }
    } catch {
      setStatus('Could not start demo generation — the request did not complete.');
    } finally {
      setPending(false);
    }
  }

  const reviewerId = `demo-reviewer-${featureId}`;
  return createElement(
    'div',
    { role: 'group', 'aria-label': `Generate demo media for ${featureLabel}`, 'data-generate-demo': featureId },
    createElement('label', { htmlFor: reviewerId }, 'Reviewer name (required)'),
    createElement('input', {
      id: reviewerId,
      name: 'reviewer',
      type: 'text',
      value: reviewer,
      autoComplete: 'name',
      onChange: (e: { target: { value: string } }) => setReviewer(e.target.value),
    }),
    createElement(
      'button',
      { type: 'button', disabled: pending, onClick: () => void generate() },
      'Generate demo media',
    ),
    createElement('p', { role: 'status', 'aria-live': 'polite' }, status),
  );
}
