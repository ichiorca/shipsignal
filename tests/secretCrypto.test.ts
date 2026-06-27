// Unit tests for the AES-256-GCM secret crypto used to store OAuth tokens encrypted at rest:
// roundtrip fidelity, key validation, and integrity (tamper/wrong-key → throw, never silent).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { decryptWithKey, encryptWithKey, parseKeyB64 } from '../app/lib/secretCrypto.ts';

const KEY = randomBytes(32);

test('encrypt → decrypt roundtrips the plaintext', () => {
  const secret = 'refresh-token-1//abc.DEF_ghi-jkl';
  const enc = encryptWithKey(secret, KEY);
  assert.notEqual(enc.ciphertext, secret); // not stored in clear
  assert.equal(decryptWithKey(enc, KEY), secret);
});

test('each encryption uses a fresh IV (ciphertext differs for the same plaintext)', () => {
  const a = encryptWithKey('same', KEY);
  const b = encryptWithKey('same', KEY);
  assert.notEqual(a.iv, b.iv);
  assert.notEqual(a.ciphertext, b.ciphertext);
});

test('decrypting with the wrong key throws (no silent wrong value)', () => {
  const enc = encryptWithKey('secret', KEY);
  assert.throws(() => decryptWithKey(enc, randomBytes(32)));
});

test('a tampered auth tag throws (GCM integrity)', () => {
  const enc = encryptWithKey('secret', KEY);
  const badTag = Buffer.from(enc.tag, 'base64');
  badTag[0] = (badTag[0] ?? 0) ^ 0xff;
  assert.throws(() => decryptWithKey({ ...enc, tag: badTag.toString('base64') }, KEY));
});

test('parseKeyB64 accepts a 32-byte base64 key and rejects the wrong length', () => {
  assert.equal(parseKeyB64(KEY.toString('base64')).length, 32);
  assert.throws(() => parseKeyB64(randomBytes(16).toString('base64')));
});
