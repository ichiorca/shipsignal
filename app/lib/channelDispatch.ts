// Path B / Phase 3 — the authenticated HTTP layer for social-channel publishing, with a dry-run
// fallback. Hackathon carve-out (operator decision 2026-06-15): NO OAuth connection flow — channel
// credentials come from env, read server-side at call time, never sent to the client, never logged
// (§5). `server-only` makes a client import a build error.
//
// Dry-run: when a channel's credential is absent (or PUBLISH_DRY_RUN is set) the dispatch does NOT
// call the live API — it returns a `dryRun: true` result describing what WOULD be posted, so the
// end-to-end loop demos cleanly without real API access. The moment a real credential is present it
// sends for real. PUBLISH_MODE (manual | scheduled) governs whether approvals may be scheduled
// (Phase 4); it does not affect the manual publish action here.

import 'server-only';
import { requireEnv, optionalEnv } from '@/app/lib/env.ts';
import type { ChannelPost } from '@/app/lib/channelPublish.ts';

/** Bound every outward channel call so a hung upstream can't pin a serverless function open (it
 *  would otherwise hold a pool connection until the platform's function timeout). */
const CHANNEL_FETCH_TIMEOUT_MS = 10_000;

export type ChannelName = 'linkedin' | 'x';

/** The outcome of a publish attempt, surfaced to the route/UI. `url` is the live post URL on a
 *  real send (when the API returns one); null on a dry run. */
export interface ChannelPublishResult {
  readonly channel: ChannelName;
  readonly dryRun: boolean;
  readonly url: string | null;
}

/** Forced dry-run for the whole deployment (e.g. a demo with real tokens you don't want to fire). */
function dryRunForced(): boolean {
  const flag = optionalEnv('PUBLISH_DRY_RUN', '').toLowerCase();
  return flag === '1' || flag === 'true' || flag === 'yes';
}

export function linkedInConfigured(): boolean {
  return (
    optionalEnv('LINKEDIN_ACCESS_TOKEN', '') !== '' && optionalEnv('LINKEDIN_ORG_ID', '') !== ''
  );
}

export function xConfigured(): boolean {
  return optionalEnv('X_ACCESS_TOKEN', '') !== '';
}

function channelConfigured(channel: ChannelName): boolean {
  return channel === 'x' ? xConfigured() : linkedInConfigured();
}

/** Whether a publish to this channel will be a dry-run (no live API call): forced globally, or the
 *  channel has no env credential. Lets the route treat a dry-run as a pure preview — no audit row,
 *  no idempotency marker — so it stays re-runnable and never blocks a later real publish. */
export function willDryRun(channel: ChannelName): boolean {
  return dryRunForced() || !channelConfigured(channel);
}

/** manual (default) | scheduled — surfaced in the Distribute status; Phase 4 gates scheduling on it. */
export function publishMode(): 'manual' | 'scheduled' {
  return optionalEnv('PUBLISH_MODE', 'manual') === 'scheduled' ? 'scheduled' : 'manual';
}

export interface ChannelStatusView {
  readonly linkedinConfigured: boolean;
  readonly xConfigured: boolean;
  readonly dryRun: boolean;
  readonly mode: 'manual' | 'scheduled';
}

/** Non-secret config snapshot for the Distribute dashboard (booleans only — never a token). */
export function channelStatus(): ChannelStatusView {
  const forced = dryRunForced();
  return {
    linkedinConfigured: linkedInConfigured(),
    xConfigured: xConfigured(),
    // The whole deployment is in dry-run if forced, or if neither channel has a credential.
    dryRun: forced || (!linkedInConfigured() && !xConfigured()),
    mode: publishMode(),
  };
}

/** Publish one post to X, or dry-run when X is unconfigured / dry-run is forced. The live call
 *  targets the v2 tweets endpoint; status-only errors (a response body may echo headers). */
export async function publishToX(post: ChannelPost): Promise<ChannelPublishResult> {
  if (dryRunForced() || !xConfigured()) {
    return { channel: 'x', dryRun: true, url: null };
  }
  const token = requireEnv('X_ACCESS_TOKEN');
  const response = await fetch('https://api.twitter.com/2/tweets', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: post.text }),
    signal: AbortSignal.timeout(CHANNEL_FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`X publish failed with status ${response.status}`);
  }
  const body = (await response.json().catch(() => ({}))) as { data?: { id?: unknown } };
  const id = body.data?.id;
  return {
    channel: 'x',
    dryRun: false,
    url: typeof id === 'string' ? `https://x.com/i/web/status/${id}` : null,
  };
}

/** Publish one post to the configured LinkedIn company page, or dry-run when unconfigured / forced.
 *  The live call targets the UGC Posts API as an organization author. */
export async function publishToLinkedIn(post: ChannelPost): Promise<ChannelPublishResult> {
  if (dryRunForced() || !linkedInConfigured()) {
    return { channel: 'linkedin', dryRun: true, url: null };
  }
  const token = requireEnv('LINKEDIN_ACCESS_TOKEN');
  const orgId = requireEnv('LINKEDIN_ORG_ID');
  const response = await fetch('https://api.linkedin.com/v2/ugcPosts', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Restli-Protocol-Version': '2.0.0',
    },
    body: JSON.stringify({
      author: `urn:li:organization:${orgId}`,
      lifecycleState: 'PUBLISHED',
      specificContent: {
        'com.linkedin.ugc.ShareContent': {
          shareCommentary: { text: post.text },
          shareMediaCategory: 'NONE',
        },
      },
      visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
    }),
    signal: AbortSignal.timeout(CHANNEL_FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`LinkedIn publish failed with status ${response.status}`);
  }
  // The created post id comes back in the X-RestLi-Id header (or the body id).
  const postId = response.headers.get('x-restli-id') ?? '';
  return {
    channel: 'linkedin',
    dryRun: false,
    url: postId !== '' ? `https://www.linkedin.com/feed/update/${postId}` : null,
  };
}
