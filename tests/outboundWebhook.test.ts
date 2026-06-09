// T3/T4/T5 (spec 019) — unit coverage for the outbound distribution webhook's pure layer:
// signing round-trip (and tamper rejection), deterministic delivery ids, payload minimization
// (no reviewer identity), fail-fast config, and the bounded retry's status-class behaviour.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ARTIFACT_APPROVED_EVENT,
  buildArtifactApprovedPayload,
  deliveryIdFor,
  getOutboundWebhookConfig,
  postWithRetry,
  signWebhookBody,
  verifyWebhookSignature,
} from '../app/lib/outboundWebhook.ts';
import type { ApprovedSnapshotView } from '../app/lib/artifactExport.ts';

const SNAPSHOT: ApprovedSnapshotView = {
  artifact_id: 'aaaaaaaa-1111-2222-3333-444444444444',
  release_run_id: 'rrrrrrrr-1111-2222-3333-444444444444',
  approval_id: 'apvapvap-1111-2222-3333-444444444444',
  artifact_type: 'release_blog',
  model_id: 'bedrock-model-x',
  prompt_version: 'v3',
  skill_versions: { 'blog-format': '2.0.0' },
  evidence_ids: ['e1111111-1111-2222-3333-444444444444'],
  claim_support: [
    { claim_id: 'c1111111-1111-2222-3333-444444444444', support_status: 'supported', risk_level: 'low' },
  ],
  reviewer_decision: 'approved',
  final_title: 'Checklists ship',
  final_body_markdown: 'Approved body.',
  content_hash: 'abc123',
  generated_at: '2026-06-01T00:00:00.000Z',
  approved_at: '2026-06-02T00:00:00.000Z',
};

const noSleep = (): Promise<void> => Promise.resolve();

// --- config -------------------------------------------------------------------------------

test('config is null (feature off) when the URL is unset or empty', () => {
  assert.equal(getOutboundWebhookConfig({}), null);
  assert.equal(getOutboundWebhookConfig({ OUTBOUND_WEBHOOK_URL: '' }), null);
});

test('a URL without a secret fails fast — never an unsigned send', () => {
  assert.throws(
    () => getOutboundWebhookConfig({ OUTBOUND_WEBHOOK_URL: 'https://consumer.example' }),
    /OUTBOUND_WEBHOOK_SECRET/,
  );
});

test('a full config round-trips url + secret', () => {
  const config = getOutboundWebhookConfig({
    OUTBOUND_WEBHOOK_URL: 'https://consumer.example/hook',
    OUTBOUND_WEBHOOK_SECRET: 's3cret',
  });
  assert.deepEqual(config, { url: 'https://consumer.example/hook', secret: 's3cret' });
});

// --- signing ------------------------------------------------------------------------------

test('sign + verify round-trips over timestamp.rawBody', () => {
  const signature = signWebhookBody('s3cret', '1770000000', '{"a":1}');
  assert.match(signature, /^sha256=[0-9a-f]{64}$/);
  assert.ok(verifyWebhookSignature('s3cret', '1770000000', '{"a":1}', signature));
});

test('verification rejects a tampered body, timestamp, secret, or signature', () => {
  const signature = signWebhookBody('s3cret', '1770000000', '{"a":1}');
  assert.ok(!verifyWebhookSignature('s3cret', '1770000000', '{"a":2}', signature));
  assert.ok(!verifyWebhookSignature('s3cret', '1770000001', '{"a":1}', signature));
  assert.ok(!verifyWebhookSignature('wrong', '1770000000', '{"a":1}', signature));
  assert.ok(!verifyWebhookSignature('s3cret', '1770000000', '{"a":1}', 'sha256=deadbeef'));
});

// --- delivery ids -------------------------------------------------------------------------

test('delivery ids are deterministic per (event, artifact) and distinct across artifacts', () => {
  const a = deliveryIdFor(ARTIFACT_APPROVED_EVENT, SNAPSHOT.artifact_id);
  assert.equal(a, deliveryIdFor(ARTIFACT_APPROVED_EVENT, SNAPSHOT.artifact_id));
  assert.notEqual(a, deliveryIdFor(ARTIFACT_APPROVED_EVENT, 'bbbbbbbb-1111-2222-3333-444444444444'));
  assert.notEqual(a, deliveryIdFor('artifact.other', SNAPSHOT.artifact_id));
});

// --- payload ------------------------------------------------------------------------------

test('the payload carries approved content + provenance and NO reviewer identity', () => {
  const payload = buildArtifactApprovedPayload(SNAPSHOT, 'd1');
  assert.equal(payload.event, 'artifact.approved');
  assert.equal(payload.delivery_id, 'd1');
  assert.equal(payload.content_hash, 'abc123');
  assert.equal(payload.final_body_markdown, 'Approved body.');
  const keys = Object.keys(payload);
  assert.ok(!keys.includes('reviewer'), 'no reviewer key');
  assert.ok(!JSON.stringify(payload).includes('"reviewer"'), 'no reviewer field serialized');
});

// --- retry --------------------------------------------------------------------------------

test('a 2xx on the first attempt succeeds without retrying', async () => {
  let calls = 0;
  const outcome = await postWithRetry(
    async () => {
      calls += 1;
      return { status: 200 };
    },
    { sleep: noSleep },
  );
  assert.deepEqual(outcome, { ok: true, status: 200, error: null, attempts: 1 });
  assert.equal(calls, 1);
});

test('5xx retries with backoff and succeeds when the endpoint recovers', async () => {
  const statuses = [500, 503, 204];
  const delays: number[] = [];
  let calls = 0;
  const outcome = await postWithRetry(
    async () => ({ status: statuses[calls++] ?? 204 }),
    { sleep: async (ms) => { delays.push(ms); } },
  );
  assert.deepEqual(outcome, { ok: true, status: 204, error: null, attempts: 3 });
  assert.deepEqual(delays, [500, 1000], 'exponential backoff between attempts');
});

test('a non-retryable 4xx records the failure and stops immediately', async () => {
  let calls = 0;
  const outcome = await postWithRetry(
    async () => {
      calls += 1;
      return { status: 403 };
    },
    { sleep: noSleep },
  );
  assert.equal(calls, 1, 'no retry on a consumer/config error');
  assert.deepEqual(outcome, { ok: false, status: 403, error: 'endpoint responded 403', attempts: 1 });
});

test('429 is retryable (rate limiting is transient)', async () => {
  const statuses = [429, 200];
  let calls = 0;
  const outcome = await postWithRetry(async () => ({ status: statuses[calls++] ?? 200 }), {
    sleep: noSleep,
  });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.attempts, 2);
});

test('persistent network failure exhausts attempts with a secret-free error', async () => {
  let calls = 0;
  const outcome = await postWithRetry(
    async () => {
      calls += 1;
      throw new TypeError('fetch failed: https://consumer.example/hook?token=leaky');
    },
    { sleep: noSleep },
  );
  assert.equal(calls, 3);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.status, null);
  assert.equal(outcome.error, 'request failed: TypeError', 'class of error only — no URL/params');
});

test('postWithRetry never throws', async () => {
  await assert.doesNotReject(
    postWithRetry(
      async () => {
        throw new Error('boom');
      },
      { sleep: noSleep },
    ),
  );
});
