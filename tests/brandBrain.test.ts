// Brand & customer brain (migration 0025) — the pure slug + input-validation logic shared by the
// /settings API routes and editors.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  slugifyIcpId,
  icpInputSchema,
  voiceExemplarInputSchema,
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

test('messagingClaimInputSchema requires text and defaults to approved positioning', () => {
  const parsed = messagingClaimInputSchema.parse({ claim_text: 'We ground claims in evidence.' });
  assert.equal(parsed.claim_type, 'positioning');
  assert.equal(parsed.status, 'approved');
  assert.deepEqual(parsed.applies_to_icp, []);
  assert.equal(messagingClaimInputSchema.safeParse({ claim_text: '' }).success, false);
});
