// Brand & customer brain (migration 0025) — the pure slug + input-validation logic shared by the
// /settings API routes and editors.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  slugifyIcpId,
  icpInputSchema,
  voiceExemplarInputSchema,
  voiceGuideInputSchema,
  messagingClaimInputSchema,
} from '../app/lib/brandBrain.ts';

test('slugifyIcpId derives a stable seg_* id, mirroring the peer repo convention', () => {
  assert.equal(slugifyIcpId('DTC merchant'), 'seg_dtc_merchant');
  assert.equal(slugifyIcpId('Ecommerce leader (mid-market)'), 'seg_ecommerce_leader_mid_market');
  assert.equal(slugifyIcpId('   '), 'seg_segment'); // degenerate input still yields a valid id
});

test('icpInputSchema requires a name and applies list/status defaults', () => {
  const ok = icpInputSchema.safeParse({ name: 'Platform engineer' });
  assert.equal(ok.success, true);
  if (ok.success) {
    assert.deepEqual(ok.data.buyer_roles, []);
    assert.equal(ok.data.status, 'active');
  }
  assert.equal(icpInputSchema.safeParse({ name: '' }).success, false);
});

test('voiceExemplarInputSchema requires content and validates the channel', () => {
  assert.equal(
    voiceExemplarInputSchema.safeParse({ body_text: 'a post in our voice' }).success,
    true,
  );
  // default channel is "any"
  const parsed = voiceExemplarInputSchema.parse({ body_text: 'x' });
  assert.equal(parsed.channel, 'any');
  // a real artifact type is accepted; junk is rejected
  assert.equal(
    voiceExemplarInputSchema.safeParse({ body_text: 'x', channel: 'release_blog' }).success,
    true,
  );
  assert.equal(
    voiceExemplarInputSchema.safeParse({ body_text: 'x', channel: 'tiktok' }).success,
    false,
  );
  assert.equal(voiceExemplarInputSchema.safeParse({ body_text: '' }).success, false);
});

test('voiceGuideInputSchema applies empty defaults and trims/limits fields', () => {
  // Every field is optional — an empty object is a valid (empty) guide.
  const empty = voiceGuideInputSchema.safeParse({});
  assert.equal(empty.success, true);
  if (empty.success) {
    assert.equal(empty.data.tone, '');
    assert.deepEqual(empty.data.do_rules, []);
    assert.deepEqual(empty.data.prefer_terms, []);
  }
  // Scalar fields are trimmed; list entries are trimmed too and must be non-empty after trimming
  // (the editor's splitLines strips blank lines before they ever reach the schema).
  const parsed = voiceGuideInputSchema.parse({
    tone: '  confident  ',
    do_rules: ['  Lead with value  '],
  });
  assert.equal(parsed.tone, 'confident'); // trimmed
  assert.deepEqual(parsed.do_rules, ['Lead with value']); // trimmed entry
  // A blank list entry is rejected outright (not silently dropped).
  assert.equal(voiceGuideInputSchema.safeParse({ do_rules: ['ok', '  '] }).success, false);
});

test('messagingClaimInputSchema requires text and defaults to approved positioning', () => {
  const parsed = messagingClaimInputSchema.parse({ claim_text: 'We ground claims in evidence.' });
  assert.equal(parsed.claim_type, 'positioning');
  assert.equal(parsed.status, 'approved');
  assert.deepEqual(parsed.applies_to_icp, []);
  assert.equal(messagingClaimInputSchema.safeParse({ claim_text: '' }).success, false);
});
