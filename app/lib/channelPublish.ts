// Path B / Phase 3 — pure channel post builders for the public social channels (X, LinkedIn,
// Hacker News). Mirrors publish.ts (GitHub/Slack): pure assembly + boundary rules only, unit-
// tested; the authenticated HTTP + env-credential reads live in channelDispatch.ts and the routes.
//
// P5 / §18.1: every post is assembled ONLY from the immutable approved snapshot (the Gate #2
// publishable truth) — never the mutable artifact row, no reviewer identity, no secrets.
// Publishing remains a human action behind Gate #2 (constitution §2: human-gated distribution).
//
// Channel mapping is strict: x_post → X, linkedin_post → LinkedIn, hackernews_post → assisted
// Show HN. Hacker News has no submit API, so its "post" is prepared content + a submit deep link.

import type { ApprovedSnapshotView } from './artifactExport.ts';

/** Hard platform limits we enforce defensively (the format skills target these, but a snapshot is
 *  boundary data — never trust it to already fit). */
export const X_POST_MAX = 280;
export const HN_TITLE_MAX = 80;
export const LINKEDIN_MAX = 2900;

/** The HN submission form (Show HN is posted by a human; there is no programmatic submit). */
export const HN_SUBMIT_URL = 'https://news.ycombinator.com/submit';

export function isXPublishable(artifactType: string): boolean {
  return artifactType === 'x_post';
}
export function isLinkedInPublishable(artifactType: string): boolean {
  return artifactType === 'linkedin_post';
}
export function isHackerNewsAssistable(artifactType: string): boolean {
  return artifactType === 'hackernews_post';
}

export interface ChannelPost {
  readonly text: string;
}

/** Collapse runs of whitespace/newlines into single spaces — social posts are single-block text. */
function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Strip the leading Markdown heading marker / "Show HN:" so a title isn't double-prefixed. */
function stripLeadingMarkers(line: string): string {
  return line
    .replace(/^#+\s*/, '')
    .replace(/^show\s+hn:\s*/i, '')
    .trim();
}

/** Word-safe truncation: cut at the last space before `limit`, append an ellipsis (counts toward
 *  the limit so the result never exceeds it). */
function wordSafeTruncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const hard = text.slice(0, limit - 1);
  const lastSpace = hard.lastIndexOf(' ');
  return `${hard.slice(0, lastSpace > 0 ? lastSpace : limit - 1).trimEnd()}…`;
}

/** A single X post from the approved body, collapsed to one block and bounded to 280 chars. */
export function buildXPost(snapshot: ApprovedSnapshotView): ChannelPost {
  return { text: wordSafeTruncate(collapseWhitespace(snapshot.final_body_markdown), X_POST_MAX) };
}

/** A LinkedIn company-page share commentary from the approved body, bounded to a safe length.
 *  Keeps the markdown body's line breaks (LinkedIn renders plain text with newlines). */
export function buildLinkedInPost(snapshot: ApprovedSnapshotView): ChannelPost {
  const body = snapshot.final_body_markdown.trim();
  return { text: body.length <= LINKEDIN_MAX ? body : wordSafeTruncate(body, LINKEDIN_MAX) };
}

export interface ShowHnSubmission {
  /** The "Show HN: …" title line (≤80 chars), ready to paste into the submit form. */
  readonly title: string;
  /** The body text for the submission's text field. */
  readonly text: string;
  /** Where the human posts it (no API). */
  readonly submitUrl: string;
}

/** Prepare a Show HN submission: the first non-empty line becomes the title (prefixed "Show HN: ",
 *  ≤80 chars), the remainder becomes the body. HN is assisted, not auto-posted. */
export function buildShowHnSubmission(snapshot: ApprovedSnapshotView): ShowHnSubmission {
  const lines = snapshot.final_body_markdown.split('\n');
  const firstIdx = lines.findIndex((l) => l.trim() !== '');
  const rawTitle =
    firstIdx >= 0 ? stripLeadingMarkers(lines[firstIdx]!) : (snapshot.final_title ?? snapshot.artifact_type);
  const title = wordSafeTruncate(`Show HN: ${rawTitle}`, HN_TITLE_MAX);
  const body = firstIdx >= 0 ? lines.slice(firstIdx + 1).join('\n').trim() : '';
  return { title, text: body, submitUrl: HN_SUBMIT_URL };
}
