// Integration: the app's presigned-GET URL (app/lib/s3Presign.ts, endpoint override)
// actually retrieves an object from a REAL LocalStack S3. This is the consumer half of
// the S3 seam; the Python test_s3_media_store_integration test is the producer half.
//
// The test uploads its own object first via a tiny TEST-ONLY SigV4 PUT presigner (mirrors
// the GET signer), then downloads it through the real `presignS3GetUrl`. A byte-for-byte
// match proves: LocalStack accepts our SigV4, path-style addressing works, and the
// endpoint override we ship routes the signed URL at LocalStack instead of AWS.
//
// Run via `npm run test:integration`; skips unless RUN_INTEGRATION=1.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { presignS3GetUrl } from '../../app/lib/s3Presign.ts';

const RUN = process.env.RUN_INTEGRATION === '1';
const endpoint = process.env.AWS_ENDPOINT_URL ?? '';
const bucket = process.env.EVIDENCE_BUCKET ?? '';
const region = process.env.AWS_REGION ?? 'us-east-1';
const credentials = {
  accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'test',
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'test',
};

const enc = (v: string): string =>
  encodeURIComponent(v).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
const sha256Hex = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');
const hmac = (key: Buffer | string, data: string): Buffer =>
  createHmac('sha256', key).update(data, 'utf8').digest();

// Minimal path-style SigV4 PUT presigner — TEST SCAFFOLDING ONLY (the app signs GETs).
function presignPutUrl(key: string, now: Date): string {
  const url = new URL(endpoint);
  const host = url.host;
  const scheme = url.protocol.replace(/:$/, '');
  const amzDate = now.toISOString().replace(/[:-]/g, '').replace(/\.\d{3}/, '');
  const dateStamp = amzDate.slice(0, 8);
  const scope = `${dateStamp}/${region}/s3/aws4_request`;
  const canonicalUri = `/${bucket}/${key.split('/').map(enc).join('/')}`;
  const q: Record<string, string> = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${credentials.accessKeyId}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': '300',
    'X-Amz-SignedHeaders': 'host',
  };
  const canonicalQuery = Object.keys(q)
    .sort()
    .map((k) => `${enc(k)}=${enc(q[k] as string)}`)
    .join('&');
  const canonicalRequest = [
    'PUT',
    canonicalUri,
    canonicalQuery,
    `host:${host}\n`,
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n');
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join('\n');
  const kDate = hmac(`AWS4${credentials.secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, 's3');
  const kSigning = hmac(kService, 'aws4_request');
  const signature = hmac(kSigning, stringToSign).toString('hex');
  return `${scheme}://${host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

test('S3 round-trip: the app presigner GETs an object PUT into LocalStack', { skip: !RUN }, async () => {
  assert.ok(endpoint !== '', 'AWS_ENDPOINT_URL must be set');
  assert.ok(bucket !== '', 'EVIDENCE_BUCKET must be set');

  const now = new Date();
  const key = `integration/roundtrip-${now.getTime()}.txt`;
  const body = `hello-localstack-${now.getTime()}`;

  const putRes = await fetch(presignPutUrl(key, now), { method: 'PUT', body });
  assert.equal(putRes.status, 200, `PUT failed: ${putRes.status} ${await putRes.text()}`);

  const getUrl = presignS3GetUrl({
    s3Uri: `s3://${bucket}/${key}`,
    region,
    credentials,
    endpoint,
    expiresInSeconds: 300,
    now,
  });
  const getRes = await fetch(getUrl);
  assert.equal(getRes.status, 200);
  assert.equal(await getRes.text(), body);
});
