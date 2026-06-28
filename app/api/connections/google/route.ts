// GET  /api/connections/google          → start the YouTube OAuth consent flow (302 to Google)
// DELETE /api/connections/google         → disconnect (erase the stored encrypted token)
//
// constitution §2/§5: human-initiated connection; the client secret stays server-side (only the
// client_id + redirect go to Google). A random `state` is set as an httpOnly cookie and verified on
// the callback (CSRF protection). The callback exchanges the code and stores the encrypted token.

import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { buildConsentUrl, GOOGLE_YOUTUBE_PROVIDER, OAUTH_STATE_COOKIE } from '@/app/lib/googleOAuth.ts';
import { callbackRedirectUri } from '@/app/lib/oauthRedirect.ts';
import { disconnectConnection } from '@/app/lib/db/connections.ts';
import { requireEnv } from '@/app/lib/env.ts';

export const runtime = 'nodejs';

export function GET(request: Request): NextResponse {
  let clientId: string;
  try {
    clientId = requireEnv('YOUTUBE_CLIENT_ID');
  } catch {
    // Misconfiguration → send the operator back with a clear, secret-free message.
    return NextResponse.redirect(
      new URL('/connections?error=client_not_configured', request.url),
      { status: 302 },
    );
  }
  const state = randomBytes(16).toString('hex');
  const url = buildConsentUrl({
    clientId,
    redirectUri: callbackRedirectUri(request),
    state,
  });
  const response = NextResponse.redirect(url, { status: 302 });
  // httpOnly + sameSite=lax so the cookie survives Google's top-level redirect back but is not
  // readable by JS; short-lived (the consent round-trip is seconds).
  response.cookies.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 600,
  });
  return response;
}

export async function DELETE(): Promise<NextResponse> {
  await disconnectConnection(GOOGLE_YOUTUBE_PROVIDER);
  return NextResponse.json({ disconnected: true }, { status: 200 });
}
