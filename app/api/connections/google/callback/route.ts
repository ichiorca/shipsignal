// GET /api/connections/google/callback — the OAuth redirect target. Verifies the CSRF state cookie,
// exchanges the authorization code for tokens, stores the refresh token ENCRYPTED, and redirects
// back to /connections. The client secret + plaintext tokens stay server-side (never to the client).

import { NextResponse } from 'next/server';
import {
  buildTokenExchangeBody,
  GOOGLE_CHANNELS_ENDPOINT,
  GOOGLE_TOKEN_ENDPOINT,
  GOOGLE_YOUTUBE_PROVIDER,
  OAUTH_STATE_COOKIE,
  YOUTUBE_UPLOAD_SCOPE,
} from '@/app/lib/googleOAuth.ts';
import { upsertConnection } from '@/app/lib/db/connections.ts';
import { requireEnv } from '@/app/lib/env.ts';
import { callbackRedirectUri } from '@/app/lib/oauthRedirect.ts';

export const runtime = 'nodejs';

const EXCHANGE_TIMEOUT_MS = 10_000;

function back(request: Request, params: string): NextResponse {
  const response = NextResponse.redirect(new URL(`/connections?${params}`, request.url), {
    status: 302,
  });
  response.cookies.delete(OAUTH_STATE_COOKIE);
  return response;
}

/** Best-effort: the connected channel's title, for a friendly "Connected as …" label. */
async function fetchChannelTitle(accessToken: string): Promise<string | null> {
  try {
    const response = await fetch(GOOGLE_CHANNELS_ENDPOINT, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(EXCHANGE_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const data: unknown = await response.json();
    const items = (data as { items?: unknown }).items;
    if (!Array.isArray(items) || items.length === 0) return null;
    const title = (items[0] as { snippet?: { title?: unknown } }).snippet?.title;
    return typeof title === 'string' && title !== '' ? title : null;
  } catch {
    return null;
  }
}

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const error = url.searchParams.get('error');
  if (error !== null) {
    // User denied consent or Google returned an error — surface a generic flag, not the raw value.
    return back(request, 'error=denied');
  }

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const cookieState = request.headers
    .get('cookie')
    ?.split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${OAUTH_STATE_COOKIE}=`))
    ?.slice(OAUTH_STATE_COOKIE.length + 1);

  if (code === null || state === null || cookieState === undefined || state !== cookieState) {
    // Missing code or a state mismatch (possible CSRF) — refuse.
    return back(request, 'error=invalid_state');
  }

  let clientId: string;
  let clientSecret: string;
  try {
    clientId = requireEnv('YOUTUBE_CLIENT_ID');
    clientSecret = requireEnv('YOUTUBE_CLIENT_SECRET');
  } catch {
    return back(request, 'error=client_not_configured');
  }

  try {
    const tokenResponse = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: buildTokenExchangeBody({
        clientId,
        clientSecret,
        code,
        redirectUri: callbackRedirectUri(request),
      }),
      signal: AbortSignal.timeout(EXCHANGE_TIMEOUT_MS),
    });
    if (!tokenResponse.ok) {
      console.error('google token exchange failed', { status: tokenResponse.status });
      return back(request, 'error=exchange_failed');
    }
    const data: unknown = await tokenResponse.json();
    const refreshToken = (data as { refresh_token?: unknown }).refresh_token;
    const accessToken = (data as { access_token?: unknown }).access_token;
    const scope = (data as { scope?: unknown }).scope;
    if (typeof refreshToken !== 'string' || refreshToken === '') {
      // Google only returns a refresh token with prompt=consent + access_type=offline (we set both),
      // unless a prior grant exists without it — tell the operator to retry/revoke.
      return back(request, 'error=no_refresh_token');
    }

    const accountLabel =
      typeof accessToken === 'string' ? await fetchChannelTitle(accessToken) : null;

    await upsertConnection({
      provider: GOOGLE_YOUTUBE_PROVIDER,
      refreshToken,
      scope: typeof scope === 'string' ? scope : YOUTUBE_UPLOAD_SCOPE,
      accountLabel,
      connectedBy: accountLabel,
    });
    return back(request, 'connected=1');
  } catch (err) {
    console.error('google oauth callback failed', { message: String(err) });
    return back(request, 'error=exchange_failed');
  }
}
