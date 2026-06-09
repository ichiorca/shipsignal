// T2 (spec 019) — export actions for ONE approved artifact: Copy Markdown + Download links
// (PRD §13.1 artifact review / §18.1 publishable truth). The copy + downloads go through
// /api/artifacts/{id}/export, so the content is always the immutable Gate #2 snapshot — never
// the mutable row the editor textarea shows. P6 (WCAG 2.2 AA): a labelled group of real
// <button>/<a> elements (keyboard-operable for free) and a polite live-region status for the
// async copy result. No secret or DB handle is involved — the island only calls the public API.
//
// Authored with React.createElement (not JSX) so it renders under the dependency-free
// `node --test` a11y harness, mirroring the other components.

'use client';

import { createElement, useState } from 'react';
import type { ReactElement } from 'react';

export interface ArtifactExportActionsProps {
  readonly artifactId: string;
  /** Accessible label for the artifact (its title or type label). */
  readonly artifactLabel: string;
}

export function ArtifactExportActions({
  artifactId,
  artifactLabel,
}: ArtifactExportActionsProps): ReactElement {
  const [status, setStatus] = useState('');
  const exportBase = `/api/artifacts/${artifactId}/export`;

  async function copyMarkdown(): Promise<void> {
    setStatus(`Copying the approved markdown for "${artifactLabel}"…`);
    try {
      const response = await fetch(`${exportBase}?format=markdown`);
      if (!response.ok) {
        setStatus(
          response.status === 409
            ? 'This artifact is not approved, so there is no approved content to copy.'
            : 'Could not load the approved markdown — please try again.',
        );
        return;
      }
      await navigator.clipboard.writeText(await response.text());
      setStatus(`Copied the approved markdown for "${artifactLabel}".`);
    } catch {
      setStatus('Could not copy — the request or the clipboard write did not complete.');
    }
  }

  return createElement(
    'div',
    {
      role: 'group',
      'aria-label': `Export ${artifactLabel}`,
      'data-export-actions': artifactId,
    },
    createElement(
      'button',
      { type: 'button', onClick: () => void copyMarkdown() },
      'Copy Markdown',
    ),
    createElement('a', { href: `${exportBase}?format=markdown` }, 'Download Markdown'),
    createElement('a', { href: `${exportBase}?format=html` }, 'Download HTML'),
    createElement('a', { href: `${exportBase}?format=json` }, 'Download JSON (provenance)'),
    createElement('p', { role: 'status', 'aria-live': 'polite' }, status),
  );
}
