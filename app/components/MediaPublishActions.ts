// Publish-to-YouTube action for ONE finished demo video (PRD §5.4 last-mile; constitution §2
// human-gated distribution). Client island: a labelled reviewer field + a single button that POSTs
// to /api/media/{id}/publish/youtube and shows the resulting watch URL (or a dry-run notice when
// no YouTube credentials are configured). P6 (WCAG 2.2 AA): real <label>/<button>/<a> elements and
// a polite live-region status. No secret or DB handle is involved — it only calls the public API.
//
// Authored with React.createElement (not JSX) so it renders under the dependency-free
// `node --test` a11y harness, mirroring the other components.

'use client';

import { createElement, useState } from 'react';
import type { ReactElement } from 'react';
import { clientFetch } from '../lib/clientFetch.ts';
import { useReviewerName } from '../lib/useReviewerName.ts';

export interface MediaPublishActionsProps {
  readonly mediaId: string;
  /** When already published, the existing watch URL — we link to it instead of a publish button. */
  readonly publishedUrl?: string | null;
}

export function MediaPublishActions({
  mediaId,
  publishedUrl,
}: MediaPublishActionsProps): ReactElement {
  const [reviewer, setReviewer] = useReviewerName();
  const [status, setStatus] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [resultUrl, setResultUrl] = useState<string | null>(publishedUrl ?? null);

  // Already published (server-rendered link, stable regardless of client state).
  if (resultUrl !== null) {
    return createElement(
      'p',
      { 'data-youtube-published': mediaId },
      'Published to YouTube: ',
      createElement('a', { href: resultUrl, target: '_blank', rel: 'noreferrer' }, resultUrl),
    );
  }

  async function publish(): Promise<void> {
    if (reviewer.trim() === '') {
      setStatus('Enter your name first — publishing records who approved it.');
      return;
    }
    setPublishing(true);
    setStatus('Publishing to YouTube…');
    try {
      const response = await clientFetch(`/api/media/${mediaId}/publish/youtube`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewer }),
      });
      const data: unknown = await response.json().catch(() => ({}));
      const url = (data as { url?: unknown }).url;
      const dryRun = (data as { dryRun?: unknown }).dryRun === true;
      if (response.ok && typeof url === 'string') {
        setResultUrl(url);
        setStatus('Published.');
      } else if (response.ok && dryRun) {
        setStatus('Dry run — no YouTube credentials configured, so nothing was uploaded.');
      } else {
        const message = (data as { error?: unknown }).error;
        setStatus(
          typeof message === 'string'
            ? message
            : `Could not publish (status ${response.status}).`,
        );
      }
    } catch {
      setStatus('Could not publish — the request did not complete.');
    } finally {
      setPublishing(false);
    }
  }

  const reviewerId = `publish-reviewer-${mediaId}`;
  return createElement(
    'div',
    { 'data-youtube-publish': mediaId },
    createElement('label', { htmlFor: reviewerId }, 'Your name (recorded with the publish): '),
    createElement('input', {
      id: reviewerId,
      name: reviewerId,
      type: 'text',
      value: reviewer,
      onChange: (e: { target: { value: string } }) => setReviewer(e.target.value),
    }),
    ' ',
    createElement(
      'button',
      {
        type: 'button',
        disabled: publishing,
        onClick: () => void publish(),
      },
      publishing ? 'Publishing…' : 'Publish to YouTube',
    ),
    createElement('p', { role: 'status', 'aria-live': 'polite' }, status),
  );
}
