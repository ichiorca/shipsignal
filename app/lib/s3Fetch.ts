// Server-only: fetch an S3 object's bytes for re-upload elsewhere (e.g. a YouTube publish).
// The app has no AWS SDK dependency; we reuse the existing SigV4 presigner to mint a short-lived
// GET URL and stream it. constitution §4/§5 + s3-rules: the bucket stays private, credentials are
// read from env server-side and never reach the client, and the signed URL is single-object/GET.

import 'server-only';
import { presignS3GetUrl } from '@/app/lib/s3Presign.ts';
import { optionalEnv, requireEnv } from '@/app/lib/env.ts';

const FETCH_TIMEOUT_MS = 120_000; // a few-MB demo video; bounded so a stall fails fast

export interface S3Object {
  readonly bytes: Uint8Array;
  readonly contentType: string;
}

/** Download one S3 object's bytes via a short-lived presigned GET URL. `fallbackContentType`
 *  is used when the object response has no Content-Type header. */
export async function fetchS3ObjectBytes(
  s3Uri: string,
  fallbackContentType = 'application/octet-stream',
): Promise<S3Object> {
  const sessionToken = optionalEnv('AWS_SESSION_TOKEN', '');
  const endpoint = optionalEnv('AWS_ENDPOINT_URL_S3', optionalEnv('AWS_ENDPOINT_URL', ''));
  const url = presignS3GetUrl({
    s3Uri,
    region: requireEnv('AWS_REGION'),
    credentials: {
      accessKeyId: requireEnv('AWS_ACCESS_KEY_ID'),
      secretAccessKey: requireEnv('AWS_SECRET_ACCESS_KEY'),
      ...(sessionToken !== '' ? { sessionToken } : {}),
    },
    expiresInSeconds: 300,
    ...(endpoint !== '' ? { endpoint } : {}),
  });

  const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok) {
    throw new Error(`s3 object fetch failed (status ${response.status})`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  const contentType = response.headers.get('content-type') ?? fallbackContentType;
  return { bytes, contentType };
}
