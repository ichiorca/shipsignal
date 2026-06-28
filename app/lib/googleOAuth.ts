// Pure Google OAuth2 helpers for the YouTube connection (no env, no 'server-only', no network) so
// the URL/param construction is node --test-able. The token exchange + channel fetch (network +
// client secret) live in the callback route, which is server-only.

export const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
export const GOOGLE_CHANNELS_ENDPOINT =
  'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true';
// Upload scope — the minimum needed to publish a video (least privilege).
export const YOUTUBE_UPLOAD_SCOPE = 'https://www.googleapis.com/auth/youtube.upload';

/** The provider key for the YouTube connection row. */
export const GOOGLE_YOUTUBE_PROVIDER = 'google_youtube';

/** The httpOnly cookie that carries the CSRF `state` across the consent round-trip. */
export const OAUTH_STATE_COOKIE = 'g_oauth_state';

/** Build the consent URL. access_type=offline + prompt=consent force Google to return a refresh
 *  token (not just an access token) every time, so a re-connect always refreshes the stored token. */
export function buildConsentUrl(input: {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly state: string;
  readonly scope?: string;
}): string {
  const params = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    response_type: 'code',
    scope: input.scope ?? YOUTUBE_UPLOAD_SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state: input.state,
  });
  return `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`;
}

/** The form body for exchanging an authorization code for tokens (authorization_code grant). */
export function buildTokenExchangeBody(input: {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly code: string;
  readonly redirectUri: string;
}): string {
  return new URLSearchParams({
    client_id: input.clientId,
    client_secret: input.clientSecret,
    code: input.code,
    redirect_uri: input.redirectUri,
    grant_type: 'authorization_code',
  }).toString();
}
