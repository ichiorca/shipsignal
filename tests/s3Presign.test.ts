// T5 (spec 002) — AC3: raw evidence is reachable only via a presigned URL. These tests
// exercise the pure SigV4 presigner: it produces a GET-scoped, single-object,
// short-expiry signed URL, is deterministic (so it is cacheable/reproducible), and
// never embeds the secret access key. No network, no AWS SDK.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { presignS3GetUrl, parseS3Uri } from '../app/lib/s3Presign.ts';

const FIXED_NOW = new Date('2026-06-07T10:00:00.000Z');
const CREDS = {
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  sessionToken: 'FwoGZXIvYXdzEXAMPLEsessiontoken',
};

function presign(overrides: Partial<Parameters<typeof presignS3GetUrl>[0]> = {}) {
  return presignS3GetUrl({
    s3Uri: 's3://release-content/evidence/relrun_001/ev_123.txt',
    region: 'us-east-1',
    credentials: CREDS,
    expiresInSeconds: 60,
    now: FIXED_NOW,
    ...overrides,
  });
}

test('parseS3Uri splits bucket and key', () => {
  assert.deepEqual(parseS3Uri('s3://my-bucket/a/b/c.txt'), {
    bucket: 'my-bucket',
    key: 'a/b/c.txt',
  });
});

test('parseS3Uri rejects non-s3 and traversal keys', () => {
  assert.throws(() => parseS3Uri('https://example.com/x'));
  assert.throws(() => parseS3Uri('s3://bucket/'));
  assert.throws(() => parseS3Uri('s3://bucket/../etc/passwd'));
});

test('presigned URL targets the right host and object path', () => {
  const url = new URL(presign());
  assert.equal(url.protocol, 'https:');
  assert.equal(url.host, 'release-content.s3.us-east-1.amazonaws.com');
  assert.equal(url.pathname, '/evidence/relrun_001/ev_123.txt');
});

test('presigned URL carries the SigV4 GET-scoped query parameters', () => {
  const url = new URL(presign());
  const p = url.searchParams;
  assert.equal(p.get('X-Amz-Algorithm'), 'AWS4-HMAC-SHA256');
  assert.equal(p.get('X-Amz-SignedHeaders'), 'host');
  assert.equal(p.get('X-Amz-Expires'), '60');
  assert.match(p.get('X-Amz-Credential') ?? '', /AKIAIOSFODNN7EXAMPLE\/20260607\/us-east-1\/s3\/aws4_request/);
  assert.equal(p.get('X-Amz-Date'), '20260607T100000Z');
  assert.equal(p.get('X-Amz-Security-Token'), CREDS.sessionToken);
  assert.match(p.get('X-Amz-Signature') ?? '', /^[0-9a-f]{64}$/);
});

test('the secret access key never appears in the URL', () => {
  assert.ok(!presign().includes(CREDS.secretAccessKey));
});

test('signing is deterministic for identical inputs', () => {
  assert.equal(presign(), presign());
});

test('a different object yields a different signature', () => {
  const a = new URL(presign());
  const b = new URL(presign({ s3Uri: 's3://release-content/evidence/relrun_001/ev_999.txt' }));
  assert.notEqual(a.searchParams.get('X-Amz-Signature'), b.searchParams.get('X-Amz-Signature'));
});

test('expiry is clamped to a 15-minute maximum', () => {
  const url = new URL(presign({ expiresInSeconds: 86_400 }));
  assert.equal(url.searchParams.get('X-Amz-Expires'), '900');
});

test('a request without a session token omits the security-token param', () => {
  const url = new URL(
    presignS3GetUrl({
      s3Uri: 's3://b/k.txt',
      region: 'us-east-1',
      credentials: { accessKeyId: 'AKIA', secretAccessKey: 'secret' },
      now: FIXED_NOW,
    }),
  );
  assert.equal(url.searchParams.get('X-Amz-Security-Token'), null);
});
