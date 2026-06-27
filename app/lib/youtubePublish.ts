// YouTube publish provider (server-only): upload a finished demo video via the Data API v3.
// constitution §2 (human-gated distribution, not autopublish) + secrets stay server-side. The pure
// types + resource builder live in ./youtube.ts (node-testable); this module owns the OAuth + the
// network upload, so it carries 'server-only' (never bundled to the client).
//
// Uploading REQUIRES OAuth2 — an API key cannot insert a video. We exchange a long-lived refresh
// token (obtained once via the youtube.upload consent flow) for a short-lived access token at call
// time, then do a single multipart/related upload (metadata + bytes). When the OAuth env is absent
// (or PUBLISH_DRY_RUN is set) we DRY-RUN: no network, no upload — mirroring how the X/LinkedIn
// channels degrade when unconfigured, so the loop is demoable without credentials.
//
// Env (read at call time, never logged, never sent to the client):
//   YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET / YOUTUBE_REFRESH_TOKEN

import 'server-only';
// Value import is RELATIVE (not the '@/' alias) to match the repo's server-only modules.
import { optionalEnv, requireEnv } from './env.ts';
import { buildVideoResource } from './youtube.ts';
import type { YouTubePublishResult, YouTubeUploadInput } from './youtube.ts';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const UPLOAD_URL =
  'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=multipart&part=snippet,status';
const WATCH_URL_PREFIX = 'https://youtu.be/';
// Token exchange is quick; the upload streams a few MB so it gets a longer bound.
const TOKEN_TIMEOUT_MS = 10_000;
const UPLOAD_TIMEOUT_MS = 120_000;

/** True when the app-level OAuth client (id+secret) is configured in env. The per-connection
 *  refresh token is supplied separately (from the encrypted DB connection, env fallback). */
export function youtubeClientConfigured(): boolean {
  return (
    optionalEnv('YOUTUBE_CLIENT_ID', '') !== '' && optionalEnv('YOUTUBE_CLIENT_SECRET', '') !== ''
  );
}

/** Exchange a refresh token for a short-lived access token (OAuth2 refresh grant). */
async function fetchAccessToken(refreshToken: string): Promise<string> {
  const params = new URLSearchParams({
    client_id: requireEnv('YOUTUBE_CLIENT_ID'),
    client_secret: requireEnv('YOUTUBE_CLIENT_SECRET'),
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
    signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
  });
  if (!response.ok) {
    // Never surface the response body (it can echo client_secret); status only.
    throw new Error(`youtube token exchange failed (status ${response.status})`);
  }
  const data: unknown = await response.json();
  const token = (data as { access_token?: unknown }).access_token;
  if (typeof token !== 'string' || token === '') {
    throw new Error('youtube token exchange returned no access_token');
  }
  return token;
}

/** Build the multipart/related body (metadata part + binary part) for `videos.insert`. */
function buildMultipartBody(
  resource: object,
  videoBytes: Uint8Array,
  contentType: string,
  boundary: string,
): Buffer {
  const preamble =
    `--${boundary}\r\n` +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    `${JSON.stringify(resource)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${contentType}\r\n\r\n`;
  const epilogue = `\r\n--${boundary}--\r\n`;
  return Buffer.concat([
    Buffer.from(preamble, 'utf-8'),
    Buffer.from(videoBytes),
    Buffer.from(epilogue, 'utf-8'),
  ]);
}

/** Upload one video to YouTube using the supplied refresh token. Returns a dry-run result (no
 *  network) when the client isn't configured, no refresh token is available, or PUBLISH_DRY_RUN is
 *  set — so the loop is safe/demoable without a live connection. */
export async function publishToYouTube(
  input: YouTubeUploadInput,
  refreshToken: string,
): Promise<YouTubePublishResult> {
  if (!youtubeClientConfigured() || refreshToken === '' || optionalEnv('PUBLISH_DRY_RUN', '') !== '') {
    return { videoId: null, url: null, dryRun: true };
  }

  const accessToken = await fetchAccessToken(refreshToken);
  const resource = buildVideoResource(input);
  const boundary = `shipsignal_${Date.now().toString(36)}`;
  const body = buildMultipartBody(resource, input.videoBytes, input.contentType, boundary);

  const response = await fetch(UPLOAD_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body,
    signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`youtube upload failed (status ${response.status})`);
  }
  const data: unknown = await response.json();
  const videoId = (data as { id?: unknown }).id;
  if (typeof videoId !== 'string' || videoId === '') {
    throw new Error('youtube upload returned no video id');
  }
  return { videoId, url: `${WATCH_URL_PREFIX}${videoId}`, dryRun: false };
}
