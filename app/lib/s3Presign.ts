// T5 (spec 002) — server-side S3 presigned GET URLs (AWS Signature V4, query-string).
// s3-rules: the UI never gets AWS credentials or a public object — it gets a presigned
// URL generated server-side, scoped to ONE object and ONE method (GET), with a short
// expiry. Buckets stay private (Block Public Access); this signed URL is the only way
// the browser reaches an evidence blob.
//
// Implemented with node:crypto (dependency-policy: prefer the stdlib over pulling in
// @aws-sdk just to sign a URL). This module is intentionally PURE — it takes the URI,
// credentials, region, and clock as arguments and never reads env or imports
// 'server-only', so it is deterministically unit-testable without network or the AWS
// SDK. The route handler (app/api/evidence/[id]/raw) owns reading the ambient
// (OIDC/STS) credentials from env and is the only caller in a request context.

import { createHash, createHmac } from 'node:crypto';

const ALGORITHM = 'AWS4-HMAC-SHA256';
const SERVICE = 's3';
// Short expiry by default; hard-cap at 15 min so a leaked URL is useless quickly.
const DEFAULT_EXPIRES_SECONDS = 60;
const MAX_EXPIRES_SECONDS = 900;

export interface AwsCredentials {
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  /** Present when using temporary/role credentials (OIDC, STS) — almost always here. */
  readonly sessionToken?: string;
}

export interface PresignInput {
  /** `s3://bucket/key…` URI of the (redacted) evidence blob. */
  readonly s3Uri: string;
  readonly region: string;
  readonly credentials: AwsCredentials;
  readonly expiresInSeconds?: number;
  /** Injectable clock for deterministic tests; defaults to now. */
  readonly now?: Date;
  /**
   * Optional S3 endpoint override, e.g. `http://localhost:4566` for LocalStack/MinIO.
   * When set, the URL is signed PATH-style (`<endpoint>/<bucket>/<key>`) against that
   * host; when omitted, the default AWS virtual-hosted endpoint is used. The route
   * handler reads this from `AWS_ENDPOINT_URL_S3`/`AWS_ENDPOINT_URL` (server-side).
   */
  readonly endpoint?: string;
}

interface S3Location {
  readonly bucket: string;
  readonly key: string;
}

/** Parse and validate an `s3://bucket/key` URI, rejecting traversal in the key. */
export function parseS3Uri(uri: string): S3Location {
  if (!uri.startsWith('s3://')) {
    throw new Error('not an s3:// URI');
  }
  const rest = uri.slice('s3://'.length);
  const slash = rest.indexOf('/');
  if (slash <= 0 || slash === rest.length - 1) {
    throw new Error('s3 URI must be s3://bucket/key');
  }
  const bucket = rest.slice(0, slash);
  const key = rest.slice(slash + 1);
  // Defense in depth: keys we mint are uuid-based, but never sign a traversal path.
  if (key.split('/').some((seg) => seg === '..' || seg === '.' || seg === '')) {
    throw new Error('s3 key contains an unsafe path segment');
  }
  return { bucket, key };
}

/** RFC 3986 encoding as AWS SigV4 requires (unreserved chars stay literal). */
function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** Encode an object key for the canonical URI: encode each segment, keep the slashes. */
function encodeKeyPath(key: string): string {
  return key.split('/').map(encodeRfc3986).join('/');
}

function sha256Hex(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

function amzDates(now: Date): { amzDate: string; dateStamp: string } {
  // 2026-06-07T10:00:00.000Z -> 20260607T100000Z ; dateStamp -> 20260607
  const amzDate = now.toISOString().replace(/[:-]/g, '').replace(/\.\d{3}/, '');
  return { amzDate, dateStamp: amzDate.slice(0, 8) };
}

function clampExpires(seconds: number | undefined): number {
  const requested = seconds ?? DEFAULT_EXPIRES_SECONDS;
  if (!Number.isFinite(requested) || requested < 1) return 1;
  return Math.min(Math.floor(requested), MAX_EXPIRES_SECONDS);
}

interface SignTarget {
  readonly scheme: string;
  readonly host: string;
  readonly canonicalUri: string;
}

/** Resolve the signing target: AWS virtual-hosted by default, or path-style against an
 *  explicit endpoint (LocalStack/MinIO) when one is supplied. The `host` here is also the
 *  only signed header, so it must equal the request host — including a non-default port. */
function resolveTarget(
  bucket: string,
  key: string,
  region: string,
  endpoint: string | undefined,
): SignTarget {
  const canonicalKey = encodeKeyPath(key);
  if (endpoint === undefined || endpoint === '') {
    // Virtual-hosted–style: bucket in the host, key is the whole path.
    return {
      scheme: 'https',
      host: `${bucket}.s3.${region}.amazonaws.com`,
      canonicalUri: `/${canonicalKey}`,
    };
  }
  // Path-style against a custom endpoint: bucket becomes the first path segment. URL()
  // throws on a malformed endpoint, failing fast rather than minting a bad signed URL.
  const parsed = new URL(endpoint);
  return {
    scheme: parsed.protocol.replace(/:$/, ''),
    host: parsed.host,
    canonicalUri: `/${bucket}/${canonicalKey}`,
  };
}

/** Build a presigned GET URL for a single S3 object. */
export function presignS3GetUrl(input: PresignInput): string {
  const { bucket, key } = parseS3Uri(input.s3Uri);
  const { region, credentials } = input;
  const { amzDate, dateStamp } = amzDates(input.now ?? new Date());
  const expires = clampExpires(input.expiresInSeconds);

  // AWS virtual-hosted by default; path-style against an explicit endpoint (LocalStack).
  const { scheme, host, canonicalUri } = resolveTarget(bucket, key, region, input.endpoint);
  const credentialScope = `${dateStamp}/${region}/${SERVICE}/aws4_request`;

  const queryParams: Record<string, string> = {
    'X-Amz-Algorithm': ALGORITHM,
    'X-Amz-Credential': `${credentials.accessKeyId}/${credentialScope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expires),
    'X-Amz-SignedHeaders': 'host',
  };
  if (credentials.sessionToken !== undefined) {
    queryParams['X-Amz-Security-Token'] = credentials.sessionToken;
  }

  const canonicalQuery = Object.keys(queryParams)
    .sort()
    .map((k) => `${encodeRfc3986(k)}=${encodeRfc3986(queryParams[k] as string)}`)
    .join('&');

  const canonicalRequest = [
    'GET',
    canonicalUri,
    canonicalQuery,
    `host:${host}\n`,
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n');

  const stringToSign = [
    ALGORITHM,
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const kDate = hmac(`AWS4${credentials.secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, SERVICE);
  const kSigning = hmac(kService, 'aws4_request');
  const signature = hmac(kSigning, stringToSign).toString('hex');

  return `${scheme}://${host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}
