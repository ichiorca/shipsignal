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
import { useReviewerName } from '../lib/useReviewerName.ts';

export interface ArtifactExportActionsProps {
  readonly artifactId: string;
  /** Accessible label for the artifact (its title or type label). */
  readonly artifactLabel: string;
  /** The §8.1 type — gates which publish destinations make sense (changelog/blog →
   *  GitHub Releases). Optional so existing render sites stay valid. */
  readonly artifactType?: string;
  /** The reviewer name from the surrounding review surface; publishing records it in the
   *  audit log, so the buttons refuse politely when it is blank. */
  readonly reviewer?: string;
}

export function ArtifactExportActions({
  artifactId,
  artifactLabel,
  artifactType,
  reviewer,
}: ArtifactExportActionsProps): ReactElement {
  const [status, setStatus] = useState('');
  const [publishing, setPublishing] = useState(false);
  const exportBase = `/api/artifacts/${artifactId}/export`;

  // Publish needs a named reviewer (audit log). On the Gate #2 review surface the reviewer is
  // supplied via the `reviewer` prop (one shared field). On the standalone approved-artifact page
  // there is no surrounding form, so when no prop is given we fall back to the shared persisted
  // reviewer name and render our OWN labelled input — otherwise the publish buttons would render
  // but always refuse. The prop, when present, takes precedence (no duplicate input on review).
  const [ownReviewer, setOwnReviewer] = useReviewerName();
  const publishCapable = artifactType !== undefined;
  const usesOwnReviewer = publishCapable && reviewer === undefined;
  const effectiveReviewer = reviewer ?? ownReviewer;

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

  // Operator feedback 2026-06-09 (priority 1): one-click publish to REAL destinations, so
  // approved content doesn't dead-end at download/copy. Human-gated by construction: the
  // buttons exist only on an approved artifact and require a named reviewer for the audit log.
  async function publish(
    destination: 'github-release' | 'slack' | 'linkedin' | 'x',
    actionLabel: string,
  ): Promise<void> {
    if (effectiveReviewer.trim() === '') {
      setStatus('Enter your reviewer name before publishing.');
      return;
    }
    setPublishing(true);
    setStatus(`${actionLabel} for "${artifactLabel}"…`);
    try {
      const response = await fetch(`/api/artifacts/${artifactId}/publish/${destination}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewer: effectiveReviewer.trim() }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        url?: unknown;
        error?: unknown;
        dryRun?: unknown;
      };
      if (response.ok) {
        const url = typeof body.url === 'string' && body.url !== '' ? ` — ${body.url}` : '';
        // Dry-run (no live channel credential): the loop ran end-to-end but nothing was sent.
        setStatus(
          body.dryRun === true
            ? `Dry run: "${artifactLabel}" would post to ${destination} — no live credential is set, so nothing was sent.`
            : `Published "${artifactLabel}" (${destination.replace('-', ' ')})${url}.`,
        );
      } else {
        setStatus(
          typeof body.error === 'string'
            ? body.error
            : `Publishing failed (status ${response.status}).`,
        );
      }
    } catch {
      setStatus('Publishing failed — could not reach the server.');
    } finally {
      setPublishing(false);
    }
  }

  // Hacker News is assisted, not automated (no submit API): fetch the prepared Show HN title +
  // body, copy them to the clipboard, and open the submit form for the human to paste and post.
  async function prepareShowHn(): Promise<void> {
    setPublishing(true);
    setStatus(`Preparing the Show HN submission for "${artifactLabel}"…`);
    try {
      const response = await fetch(`/api/artifacts/${artifactId}/publish/hackernews`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const body = (await response.json().catch(() => ({}))) as {
        title?: unknown;
        text?: unknown;
        submitUrl?: unknown;
        error?: unknown;
      };
      if (!response.ok || typeof body.title !== 'string' || typeof body.submitUrl !== 'string') {
        setStatus(
          typeof body.error === 'string'
            ? body.error
            : `Could not prepare the Show HN submission (status ${response.status}).`,
        );
        return;
      }
      const text = typeof body.text === 'string' ? body.text : '';
      try {
        await navigator.clipboard.writeText(`${body.title}\n\n${text}`);
      } catch {
        // Clipboard may be unavailable; the submit form still opens with the title in hand.
      }
      window.open(body.submitUrl, '_blank', 'noopener');
      setStatus(`Show HN ready: "${body.title}" copied — paste it into the submit form that opened.`);
    } catch {
      setStatus('Could not prepare the Show HN submission — could not reach the server.');
    } finally {
      setPublishing(false);
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
    usesOwnReviewer
      ? createElement(
          'span',
          { 'data-reviewer-field': artifactId },
          createElement(
            'label',
            { htmlFor: `publish-reviewer-${artifactId}` },
            'Reviewer name (required to publish)',
          ),
          createElement('input', {
            id: `publish-reviewer-${artifactId}`,
            name: 'reviewer',
            type: 'text',
            value: ownReviewer,
            autoComplete: 'name',
            onChange: (e: { target: { value: string } }) => setOwnReviewer(e.target.value),
          }),
        )
      : null,
    artifactType === 'changelog_entry' || artifactType === 'release_blog'
      ? createElement(
          'button',
          {
            type: 'button',
            disabled: publishing,
            onClick: () => void publish('github-release', 'Publishing the GitHub Release'),
          },
          'Publish to GitHub Releases',
        )
      : null,
    artifactType !== undefined
      ? createElement(
          'button',
          {
            type: 'button',
            disabled: publishing,
            onClick: () => void publish('slack', 'Announcing in Slack'),
          },
          'Announce in Slack',
        )
      : null,
    // Path B / Phase 3 — the public social channels. Each button shows only for the matching
    // artifact type; an unconfigured channel publishes as a dry-run (the status line says so).
    artifactType === 'linkedin_post'
      ? createElement(
          'button',
          {
            type: 'button',
            disabled: publishing,
            onClick: () => void publish('linkedin', 'Publishing to LinkedIn'),
          },
          'Publish to LinkedIn',
        )
      : null,
    artifactType === 'x_post'
      ? createElement(
          'button',
          {
            type: 'button',
            disabled: publishing,
            onClick: () => void publish('x', 'Publishing to X'),
          },
          'Publish to X',
        )
      : null,
    artifactType === 'hackernews_post'
      ? createElement(
          'button',
          { type: 'button', disabled: publishing, onClick: () => void prepareShowHn() },
          'Prepare Show HN',
        )
      : null,
    createElement('p', { role: 'status', 'aria-live': 'polite' }, status),
  );
}
