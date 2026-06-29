// Admin → Connections: link external accounts so approved content can publish directly. Today:
// Google/YouTube (publish a demo video). The OAuth refresh token is stored AES-256-GCM-encrypted
// (migration 0038); only the token-free connection view reaches this page. Server Component: reads
// Aurora server-side and renders the client connect/disconnect island. P6 (WCAG 2.2 AA): one <main>
// landmark, headed sections, polite status messaging.

import { PageHeader } from '@/app/components/PageHeader.ts';
import { ConnectionsManager } from '@/app/components/ConnectionsManager.ts';
import { getConnectionView } from '@/app/lib/db/connections.ts';
import { GOOGLE_YOUTUBE_PROVIDER } from '@/app/lib/googleOAuth.ts';

export const dynamic = 'force-dynamic';

// Map the callback's ?connected/?error flag to a human, secret-free message.
const MESSAGES: Readonly<Record<string, string>> = {
  '1': 'Connected to Google/YouTube.',
  denied: 'Connection was cancelled or denied.',
  invalid_state: 'Connection failed a security check (state mismatch). Please try again.',
  no_refresh_token:
    'Google did not return a refresh token. Revoke ShipSignal’s access in your Google account, then reconnect.',
  exchange_failed: 'Could not complete the connection (token exchange failed). Please retry.',
  client_not_configured:
    'The Google OAuth client is not configured (set YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET).',
};

interface PageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function flagMessage(params: Record<string, string | string[] | undefined>): string | null {
  const connected = params['connected'];
  if (typeof connected === 'string' && MESSAGES[connected] !== undefined) return MESSAGES[connected];
  const error = params['error'];
  if (typeof error !== 'string') return null;
  const base = MESSAGES[error] ?? 'Connection failed. Please retry.';
  // The callback appends Google's error code (e.g. invalid_client, invalid_grant,
  // redirect_uri_mismatch) as ?detail= so the failure is diagnosable, secret-free.
  const detail = params['detail'];
  return typeof detail === 'string' && detail !== '' ? `${base} (Google: ${detail})` : base;
}

export default async function ConnectionsPage({ searchParams }: PageProps) {
  const [connection, params] = await Promise.all([
    getConnectionView(GOOGLE_YOUTUBE_PROVIDER),
    searchParams,
  ]);
  const message = flagMessage(params);

  return (
    <main id="main">
      <nav aria-label="Breadcrumb">
        <a href="/admin">← Admin</a>
      </nav>
      <PageHeader
        eyebrow="Settings"
        title="Connections"
        description="Link external accounts so approved content can publish directly. Tokens are encrypted at rest."
      />

      {message === null ? null : (
        <p role="status" data-flash>
          {message}
        </p>
      )}

      <section aria-labelledby="youtube-heading">
        <h2 id="youtube-heading">Google / YouTube</h2>
        <p>
          Connect a YouTube channel so an approved demo video can be published to it from the media
          review screen. ShipSignal requests only the upload scope; the refresh token is stored
          encrypted and never shown.
        </p>
        <ConnectionsManager
          connected={connection !== null}
          accountLabel={connection?.account_label ?? null}
        />
        {connection === null ? null : (
          <p data-connected-since>
            Connected{connection.connected_at ? ` since ${connection.connected_at.slice(0, 10)}` : ''}
            {connection.scope ? ` · scope: ${connection.scope}` : ''}.
          </p>
        )}
      </section>
    </main>
  );
}
