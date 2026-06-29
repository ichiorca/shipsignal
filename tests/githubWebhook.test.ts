// T4 (spec 001) — AC: a valid signature is accepted; an invalid signature is rejected
// 401; a replayed delivery GUID is ignored (no duplicate run). These tests exercise
// the exact functions the webhook route handler calls.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  verifyGithubSignature,
  extractReleaseTagDelivery,
  InMemoryDeliveryGuidStore,
} from '../app/lib/githubWebhook.ts';

const SECRET = 'test-webhook-secret';

function sign(body: string, secret = SECRET): string {
  return `sha256=${createHmac('sha256', secret).update(Buffer.from(body, 'utf8')).digest('hex')}`;
}

test('accepts a delivery signed with the correct secret', () => {
  const body = JSON.stringify({ action: 'published' });
  const result = verifyGithubSignature(body, sign(body), SECRET);
  assert.equal(result.ok, true);
});

test('rejects a delivery signed with the wrong secret (401)', () => {
  const body = JSON.stringify({ action: 'published' });
  const result = verifyGithubSignature(body, sign(body, 'attacker-secret'), SECRET);
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.status, 401);
});

test('rejects a missing signature header (401)', () => {
  const result = verifyGithubSignature('{}', null, SECRET);
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.status, 401);
});

test('rejects a malformed (non sha256=) signature header (401)', () => {
  const result = verifyGithubSignature('{}', 'deadbeef', SECRET);
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.status, 401);
});

test('rejects when the body is tampered after signing (401)', () => {
  const signed = JSON.stringify({ action: 'published', tag: 'v1.0.0' });
  const tampered = JSON.stringify({ action: 'published', tag: 'v9.9.9' });
  const result = verifyGithubSignature(tampered, sign(signed), SECRET);
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.status, 401);
});

test('treats an unset secret as a rejection, not a pass-through', () => {
  const result = verifyGithubSignature('{}', sign('{}', ''), '');
  assert.equal(result.ok, false);
});

test('delivery-GUID store marks a new GUID then ignores its replay', () => {
  const store = new InMemoryDeliveryGuidStore();
  const guid = '11111111-2222-3333-4444-555555555555';
  assert.equal(store.markIfNew(guid), true, 'first delivery is new');
  assert.equal(store.markIfNew(guid), false, 'replay is ignored');
  assert.equal(store.markIfNew('different-guid'), true, 'distinct GUID is new');
});

test('extractReleaseTagDelivery pulls repo + tag from a release payload', () => {
  const delivery = extractReleaseTagDelivery({
    action: 'published',
    repository: { full_name: 'org/product' },
    release: { tag_name: 'v1.13.0' },
  });
  assert.deepEqual(delivery, { repo: 'org/product', tag: 'v1.13.0', previousTag: null });
});

test('extractReleaseTagDelivery returns null for non-release / malformed payloads', () => {
  assert.equal(extractReleaseTagDelivery(null), null);
  assert.equal(extractReleaseTagDelivery({ repository: { full_name: 'org/product' } }), null);
  assert.equal(extractReleaseTagDelivery({ release: { tag_name: 'v1' } }), null);
  assert.equal(
    extractReleaseTagDelivery({ repository: { full_name: '' }, release: { tag_name: 'v1' } }),
    null,
  );
});

test('extractReleaseTagDelivery ignores non-published release actions (edited/deleted/created)', () => {
  for (const action of ['edited', 'deleted', 'created', 'prereleased', 'unpublished', 'released']) {
    assert.equal(
      extractReleaseTagDelivery({
        action,
        repository: { full_name: 'org/product' },
        release: { tag_name: 'v1.13.0' },
      }),
      null,
      `action=${action} must be ignored (only 'published' creates a run)`,
    );
  }
});

test('extractReleaseTagDelivery ignores a release event with a missing/non-string action', () => {
  // Untrusted payload: absent or wrong-typed action is not a published release.
  assert.equal(
    extractReleaseTagDelivery({
      repository: { full_name: 'org/product' },
      release: { tag_name: 'v1.13.0' },
    }),
    null,
  );
  assert.equal(
    extractReleaseTagDelivery({
      action: 1,
      repository: { full_name: 'org/product' },
      release: { tag_name: 'v1.13.0' },
    }),
    null,
  );
});
