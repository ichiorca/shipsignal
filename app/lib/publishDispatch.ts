// One-click publish — the authenticated HTTP layer (operator feedback 2026-06-09).
// github-rules + P5: the GitHub token and Slack webhook URL are read server-side from env at
// call time, never sent to the client, never logged; errors surface status codes only (a
// response body may echo headers). `server-only` makes a client import a build error.
//
// Idempotency: the GitHub publish is keyed by the release TAG — an existing release for the
// tag is UPDATED in place (upsert), so re-clicking the button can never stack duplicate
// releases. Slack has no upsert; the announce is a deliberate human action per click.

import 'server-only';
import { requireEnv } from '@/app/lib/env.ts';
import { assertRepoSlug, assertGitRef } from '@/app/lib/githubRefs.ts';
import type { GitHubReleasePayload } from '@/app/lib/publish.ts';

const GITHUB_HEADERS = (token: string): Record<string, string> => ({
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'Content-Type': 'application/json',
});

export interface PublishedRelease {
  /** The public URL of the created/updated release (shown to the reviewer). */
  readonly html_url: string;
  /** False when an existing release for the tag was updated instead of created. */
  readonly created: boolean;
}

/** Create the GitHub Release for `tag` on `repo`, or update the existing one (tag-keyed
 *  upsert). Throws with a status-only message on any non-2xx/404 outcome. */
export async function publishGitHubRelease(
  repo: string,
  payload: GitHubReleasePayload,
): Promise<PublishedRelease> {
  const token = requireEnv('GITHUB_TOKEN');
  const safeRepo = assertRepoSlug(repo);
  const tag = assertGitRef(payload.tag_name);
  const base = `https://api.github.com/repos/${safeRepo}/releases`;

  const existing = await fetch(`${base}/tags/${encodeURIComponent(tag)}`, {
    headers: GITHUB_HEADERS(token),
    signal: AbortSignal.timeout(10_000),
  });

  if (existing.ok) {
    const release = (await existing.json()) as { id?: unknown };
    if (typeof release.id !== 'number') {
      throw new Error('GitHub release lookup returned an unexpected shape');
    }
    const updated = await fetch(`${base}/${release.id}`, {
      method: 'PATCH',
      headers: GITHUB_HEADERS(token),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
    if (!updated.ok) {
      throw new Error(`GitHub release update failed with status ${updated.status}`);
    }
    const body = (await updated.json()) as { html_url?: unknown };
    return { html_url: typeof body.html_url === 'string' ? body.html_url : '', created: false };
  }

  if (existing.status !== 404) {
    throw new Error(`GitHub release lookup failed with status ${existing.status}`);
  }

  const created = await fetch(base, {
    method: 'POST',
    headers: GITHUB_HEADERS(token),
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000),
  });
  if (!created.ok) {
    throw new Error(`GitHub release create failed with status ${created.status}`);
  }
  const body = (await created.json()) as { html_url?: unknown };
  return { html_url: typeof body.html_url === 'string' ? body.html_url : '', created: true };
}

/** The announce destination, or null when Slack is unconfigured (the feature is off —
 *  mirrors the spec-020 worker contract for the same env var). */
export function slackConfigured(): boolean {
  const url = process.env.SLACK_WEBHOOK_URL ?? '';
  return url.startsWith('https://');
}

/** POST one announcement to the configured Slack incoming webhook. The URL embeds a
 *  credential (spec 020): read at call time, never logged, status-only errors. */
export async function announceToSlack(message: { readonly text: string }): Promise<void> {
  const url = requireEnv('SLACK_WEBHOOK_URL');
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(message),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`Slack announce failed with status ${response.status}`);
  }
}
