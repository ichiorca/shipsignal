// T5 (spec 002) — GET /api/evidence/[id]/raw : the ONLY path by which the browser
// reaches an evidence blob. constitution §4/§5 + s3-rules: the bucket is private; we
// mint a short-expiry, GET-scoped, single-object presigned URL server-side and 302 to
// it. The AWS credentials are read from env here (server context) and never returned
// to the client. The object itself holds the REDACTED full excerpt (redact-before-
// persist), so even the signed content is safe.

import { NextResponse } from 'next/server';
import { getEvidenceRawLocation } from '@/app/lib/db/evidenceItems.ts';
import { presignS3GetUrl } from '@/app/lib/s3Presign.ts';
import { requireEnv, optionalEnv } from '@/app/lib/env.ts';

// Signing + Aurora need the Node.js runtime (not Edge); secrets must stay server-side.
export const runtime = 'nodejs';

// UUID v4 shape the evidence_items.id column uses; reject anything else before a query.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PRESIGN_EXPIRY_SECONDS = 60;

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await context.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'invalid evidence id' }, { status: 400 });
  }

  const location = await getEvidenceRawLocation(id);
  if (location === null) {
    return NextResponse.json({ error: 'evidence not found' }, { status: 404 });
  }

  const sessionToken = optionalEnv('AWS_SESSION_TOKEN', '');
  const url = presignS3GetUrl({
    s3Uri: location.s3_uri,
    region: requireEnv('AWS_REGION'),
    credentials: {
      accessKeyId: requireEnv('AWS_ACCESS_KEY_ID'),
      secretAccessKey: requireEnv('AWS_SECRET_ACCESS_KEY'),
      ...(sessionToken !== '' ? { sessionToken } : {}),
    },
    expiresInSeconds: PRESIGN_EXPIRY_SECONDS,
  });

  // 302 to the short-lived signed URL. The URL is single-use-ish (expires in 60s) and
  // scoped to this one object; no caching of the redirect.
  return NextResponse.redirect(url, { status: 302, headers: { 'Cache-Control': 'no-store' } });
}
