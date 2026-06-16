// Path B / Phase 3 — channel connection status for the Distribute page. With OAuth deferred for the
// hackathon, "connected" simply means the channel's env credential is present; an unconfigured
// channel publishes as a DRY RUN (the loop runs, nothing is sent). This surfaces that plainly so
// the operator knows whether a real post will go out.
//
// P6 (WCAG 2.2 AA): a semantic <dl> so each channel has a programmatic label; state is conveyed as
// TEXT (a data-attribute adds colour as an enhancement, never the sole signal). Purely
// presentational, decoupled from the server-only dispatch module (it takes plain booleans), so it
// renders under the dependency-free `node --test` harness.

import { createElement } from 'react';
import type { ReactElement } from 'react';

export interface ChannelStatusProps {
  readonly linkedinConfigured: boolean;
  readonly xConfigured: boolean;
  /** True when the whole deployment is in dry-run (forced, or no channel has a credential). */
  readonly dryRun: boolean;
  readonly mode: 'manual' | 'scheduled';
}

function channelRow(name: string, configured: boolean): ReactElement {
  const state = configured ? 'Connected' : 'Dry run — no credential set';
  return createElement(
    'div',
    { key: name, 'data-channel': name.toLowerCase() },
    createElement('dt', null, name),
    createElement(
      'dd',
      { 'data-channel-state': configured ? 'connected' : 'dry-run' },
      state,
    ),
  );
}

export function ChannelStatus({
  linkedinConfigured,
  xConfigured,
  dryRun,
  mode,
}: ChannelStatusProps): ReactElement {
  return createElement(
    'div',
    { 'data-channel-status': true },
    dryRun
      ? createElement(
          'p',
          { role: 'note', 'data-dry-run-note': true },
          'Dry-run mode: posts are prepared and the full flow runs, but nothing is sent until a ' +
            'channel credential is configured. Set the channel env vars to publish for real.',
        )
      : null,
    createElement(
      'dl',
      { 'data-hero-stats': true },
      channelRow('LinkedIn', linkedinConfigured),
      channelRow('X', xConfigured),
      // Hacker News is always assisted — no API, so it is never "connected" in the credential sense.
      createElement(
        'div',
        { 'data-channel': 'hackernews' },
        createElement('dt', null, 'Hacker News'),
        createElement('dd', { 'data-channel-state': 'assisted' }, 'Assisted (prepare & submit)'),
      ),
      createElement(
        'div',
        { 'data-channel': 'mode' },
        createElement('dt', null, 'Publish mode'),
        createElement('dd', { 'data-publish-mode': mode }, mode === 'scheduled' ? 'Scheduled' : 'Manual'),
      ),
    ),
  );
}
