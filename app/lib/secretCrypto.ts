// AES-256-GCM secret encryption for at-rest storage of OAuth tokens (Admin → Connections).
// PURE: the key is passed in (no env, no 'server-only'), so it is node --test-able. The env-key
// wrapper lives in the server-only connections repo. node:crypto only — no new dependency.
//
// GCM gives confidentiality + integrity: a tampered ciphertext/iv/tag fails decryption (throws),
// so a corrupted or swapped row can never silently yield a wrong-but-plausible token.

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/** An encrypted secret, all parts base64. Stored as three columns (ciphertext/iv/tag). */
export interface EncryptedSecret {
  readonly ciphertext: string;
  readonly iv: string;
  readonly tag: string;
}

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // GCM standard nonce length
const KEY_BYTES = 32; // AES-256

/** Decode + validate a base64 32-byte key (the CONNECTIONS_ENCRYPTION_KEY value). */
export function parseKeyB64(b64: string): Buffer {
  const key = Buffer.from(b64, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `encryption key must decode to ${KEY_BYTES} bytes (got ${key.length}); ` +
        'generate with: openssl rand -base64 32',
    );
  }
  return key;
}

/** Encrypt UTF-8 plaintext with a 32-byte key. A fresh random IV per call. */
export function encryptWithKey(plaintext: string, key: Buffer): EncryptedSecret {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
  };
}

/** Decrypt an {@link EncryptedSecret} with the same key. Throws if the key is wrong or any part
 *  was tampered with (GCM auth-tag check). */
export function decryptWithKey(enc: EncryptedSecret, key: Buffer): string {
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(enc.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(enc.tag, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(enc.ciphertext, 'base64')),
    decipher.final(),
  ]);
  return plaintext.toString('utf8');
}
