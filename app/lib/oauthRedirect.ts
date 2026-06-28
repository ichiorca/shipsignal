// Shared OAuth redirect-URI derivation for the Google connection routes. Lives outside the route
// files because Next.js route modules may only export its known handlers/config (GET/POST/runtime/…)
// — exporting a helper from a route is a build error. Server-only (reads env via env.ts).

import { optionalEnv } from '@/app/lib/env.ts';

/** The callback URL Google redirects to — must EXACTLY match an authorized redirect URI on the
 *  OAuth client AND be identical between the consent start and the token exchange. Overridable via
 *  GOOGLE_OAUTH_REDIRECT_URI for a fixed canonical domain; defaults to this request's origin so dev
 *  (localhost) and prod both work without config. */
export function callbackRedirectUri(request: Request): string {
  const override = optionalEnv('GOOGLE_OAUTH_REDIRECT_URI', '');
  if (override !== '') return override;
  return `${new URL(request.url).origin}/api/connections/google/callback`;
}
