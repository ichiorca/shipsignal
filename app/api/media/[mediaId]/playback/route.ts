// T6 (spec 008) — GET /api/media/[mediaId]/playback : the ONLY path by which the browser
// reaches a rendered demo-media blob (PRD §5.4 / AC: "media reaches the client only via
// presigned URL"). constitution §4/§5 + s3-rules: the media bucket is private; we mint a
// short-expiry, GET-scoped, single-object presigned URL server-side and 302 to it. The AWS
// credentials are read from env here (server context) and never returned to the client. The
// s3_uri itself never leaves the server — the client only ever sees the time-limited signed URL.

import { NextResponse } from 'next/server';
import { getMediaPlaybackLocation } from '@/app/lib/db/mediaAssets.ts';
import { presignS3GetUrl } from '@/app/lib/s3Presign.ts';
import { requireEnv, optionalEnv } from '@/app/lib/env.ts';

// Signing + Aurora need the Node.js runtime (not Edge); secrets must stay server-side.
export const runtime = 'nodejs';

// UUID v4 shape the media_assets.id column uses; reject anything else before a query.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Media is larger than evidence text; allow a slightly longer (still short) window so a
// player can buffer, but well under the 15-minute hard cap in presignS3GetUrl.
const PRESIGN_EXPIRY_SECONDS = 300;

export async function GET(
  _request: Request,
  context: { params: Promise<{ mediaId: string }> },
): Promise<NextResponse> {
  const { mediaId } = await context.params;
  if (!UUID_RE.test(mediaId)) {
    return NextResponse.json({ error: 'invalid media id' }, { status: 400 });
  }

  const location = await getMediaPlaybackLocation(mediaId);
  if (location === null) {
    return NextResponse.json({ error: 'media not found' }, { status: 404 });
  }

  const sessionToken = optionalEnv('AWS_SESSION_TOKEN', '');
  // Local dev: route the signed URL at LocalStack/MinIO (path-style) when an endpoint is
  // configured; in prod neither var is set, so this stays the default AWS endpoint.
  const endpoint = optionalEnv('AWS_ENDPOINT_URL_S3', optionalEnv('AWS_ENDPOINT_URL', ''));
  const url = presignS3GetUrl({
    s3Uri: location.s3_uri,
    region: requireEnv('AWS_REGION'),
    credentials: {
      accessKeyId: requireEnv('AWS_ACCESS_KEY_ID'),
      secretAccessKey: requireEnv('AWS_SECRET_ACCESS_KEY'),
      ...(sessionToken !== '' ? { sessionToken } : {}),
    },
    expiresInSeconds: PRESIGN_EXPIRY_SECONDS,
    ...(endpoint !== '' ? { endpoint } : {}),
  });

  // 302 to the short-lived signed URL, scoped to this one object; never cache the redirect.
  return NextResponse.redirect(url, {
    status: 302,
    headers: { 'Cache-Control': 'no-store' },
  });
}
