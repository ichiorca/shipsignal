// Admin → Connections: connect/disconnect a provider (Google/YouTube). Client island. "Connect" is
// a plain link to the server GET route (which 302s to Google's consent screen — a full top-level
// navigation, required for OAuth). "Disconnect" is a DELETE that erases the stored encrypted token.
// P6 (WCAG 2.2 AA): real <a>/<button> + a polite live-region status. The token never reaches here.
//
// Authored with React.createElement (not JSX) so it renders under the dependency-free node --test
// a11y harness, mirroring the other components.

'use client';

import { createElement, useState } from 'react';
import type { ReactElement } from 'react';
import { clientFetch } from '../lib/clientFetch.ts';

export interface ConnectionsManagerProps {
  readonly connected: boolean;
  readonly accountLabel?: string | null;
}

export function ConnectionsManager({
  connected,
  accountLabel,
}: ConnectionsManagerProps): ReactElement {
  const [status, setStatus] = useState('');
  const [pending, setPending] = useState(false);

  async function disconnect(): Promise<void> {
    setPending(true);
    setStatus('Disconnecting…');
    try {
      const response = await clientFetch('/api/connections/google', { method: 'DELETE' });
      if (response.ok) window.location.reload();
      else setStatus(`Could not disconnect (status ${response.status}).`);
    } catch {
      setStatus('Could not disconnect — the request did not complete.');
    } finally {
      setPending(false);
    }
  }

  const action = connected
    ? createElement(
        'button',
        { type: 'button', disabled: pending, onClick: () => void disconnect() },
        pending ? 'Disconnecting…' : 'Disconnect',
      )
    : createElement(
        'a',
        { href: '/api/connections/google', 'data-connect': 'google_youtube', role: 'button' },
        'Connect Google (YouTube)',
      );

  return createElement(
    'div',
    { 'data-connection': 'google_youtube' },
    createElement(
      'p',
      { 'data-connection-status': connected ? 'connected' : 'disconnected' },
      connected
        ? `Connected${accountLabel ? ` as ${accountLabel}` : ''}.`
        : 'Not connected.',
    ),
    action,
    createElement('p', { role: 'status', 'aria-live': 'polite' }, status),
  );
}
