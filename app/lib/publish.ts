// One-click publish (operator feedback 2026-06-09, priority 1): turn approved content into
// a real release announcement — a GitHub Release body and a Slack announcement — instead of
// dead-ending at download/copy/generic webhook. Pure assembly + boundary schemas only (unit-
// tested); the authenticated HTTP calls live in app/lib/publishDispatch.ts and the routes.
//
// P5 (Safety rails) / §18.1: every payload is assembled ONLY from the immutable approved
// snapshot (the publishable truth frozen at Gate #2) and carries no reviewer identity, no
// evidence excerpts, no secrets. Publishing is a HUMAN action (a button behind Gate #2
// approval) — this is human-gated distribution, not autopublishing (constitution §2).

import { z } from 'zod';
import {
  claimSupportSummary,
  renderMarkdownExport,
  type ApprovedSnapshotView,
} from './artifactExport.ts';

// A human reviewer identifier, required so every publish action names an accountable
// human in the approvals audit log (mirrors the generate-demo trigger contract).
export const publishRequestSchema = z
  .object({
    reviewer: z.string().trim().min(1).max(254),
    notes: z.string().trim().max(4000).optional(),
  })
  .strict();

export type PublishRequest = z.infer<typeof publishRequestSchema>;

/** The §8.1 types that make sense as a GitHub Release body. */
const GITHUB_PUBLISHABLE_TYPES: readonly string[] = ['changelog_entry', 'release_blog'];

export function isGitHubPublishable(artifactType: string): boolean {
  return GITHUB_PUBLISHABLE_TYPES.includes(artifactType);
}

export interface GitHubReleasePayload {
  readonly tag_name: string;
  readonly name: string;
  readonly body: string;
}

/** Assemble the GitHub Release for one approved changelog/blog: the release is keyed to the
 *  run's head ref (the released tag), titled with the approved title, and bodied with the
 *  rendered markdown export — which already carries UTM-stamped links and the provenance
 *  trust footer, so the published release proves its own evidence-linking. */
export function buildGitHubReleasePayload(
  snapshot: ApprovedSnapshotView,
  tag: string,
): GitHubReleasePayload {
  return {
    tag_name: tag,
    name: snapshot.final_title ?? `Release ${tag}`,
    body: renderMarkdownExport(snapshot),
  };
}

// Slack messages should stay scannable; long bodies are excerpted with a pointer back to
// the dashboard (and Slack hard-caps text length far above this anyway).
const SLACK_EXCERPT_CHARS = 1200;

/** Word-safe excerpt: cut at the last whitespace before the limit, append an ellipsis. */
function excerpt(body: string, limit: number): string {
  if (body.length <= limit) return body;
  const cut = body.slice(0, limit);
  const lastSpace = cut.lastIndexOf(' ');
  return `${cut.slice(0, lastSpace > 0 ? lastSpace : limit).trimEnd()} …`;
}

/** Assemble the Slack announcement (mrkdwn) for one approved artifact: title, a bounded
 *  body excerpt, the provenance line, and a dashboard link when the base URL is known. */
export function buildSlackAnnouncement(
  snapshot: ApprovedSnapshotView,
  dashboardBaseUrl: string | null,
): { readonly text: string } {
  const { supported, total } = claimSupportSummary(snapshot);
  const provenance =
    total === 0
      ? 'No factual claims extracted.'
      : `${supported}/${total} claims evidence-linked.`;
  const title = snapshot.final_title ?? snapshot.artifact_type;
  const lines = [
    `*${title}*`,
    '',
    excerpt(snapshot.final_body_markdown, SLACK_EXCERPT_CHARS),
    '',
    `_${provenance} Human-approved at Gate #2 · shipsignal_`,
  ];
  if (dashboardBaseUrl !== null && dashboardBaseUrl !== '') {
    lines.push(
      `<${dashboardBaseUrl.replace(/\/$/, '')}/releases/${snapshot.release_run_id}/artifacts|View the run's artifacts>`,
    );
  }
  return { text: lines.join('\n') };
}
