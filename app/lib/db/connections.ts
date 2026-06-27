// connections repository (migration 0038): per-provider OAuth connections whose refresh token is
// stored AES-256-GCM-encrypted. Server-only (it imports aurora + reads CONNECTIONS_ENCRYPTION_KEY).
//
// constitution §4/§5 (operator-authorized deviation): only ciphertext is persisted; the plaintext
// token is decrypted on demand for the publish call and NEVER returned to the client or logged. The
// connection VIEW (for the UI) excludes the token entirely.

import { query, type Queryable } from '@/app/lib/aurora.ts';
import { requireEnv } from '@/app/lib/env.ts';
import { decryptWithKey, encryptWithKey, parseKeyB64 } from '@/app/lib/secretCrypto.ts';

/** The token-free view the Connections page renders (never includes the secret). */
export interface ConnectionView {
  readonly provider: string;
  readonly status: string;
  readonly account_label: string | null;
  readonly scope: string | null;
  readonly connected_by: string | null;
  readonly connected_at: string;
}

function encryptionKey(): Buffer {
  return parseKeyB64(requireEnv('CONNECTIONS_ENCRYPTION_KEY'));
}

/** The active connection for a provider (status='connected'), token excluded. Null if none. */
export async function getConnectionView(provider: string): Promise<ConnectionView | null> {
  const result = await query<{
    provider: string;
    status: string;
    account_label: string | null;
    scope: string | null;
    connected_by: string | null;
    connected_at: string | Date;
  }>(
    `SELECT provider, status, account_label, scope, connected_by, connected_at
       FROM connections WHERE provider = $1 AND status = 'connected'`,
    [provider],
  );
  const row = result.rows[0];
  if (row === undefined) return null;
  return {
    provider: row.provider,
    status: row.status,
    account_label: row.account_label,
    scope: row.scope,
    connected_by: row.connected_by,
    connected_at:
      row.connected_at instanceof Date ? row.connected_at.toISOString() : String(row.connected_at),
  };
}

/** Decrypt + return the stored refresh token for a connected provider, or null if not connected.
 *  Server-only; the result is used immediately for a token exchange and never persisted/logged. */
export async function getDecryptedRefreshToken(provider: string): Promise<string | null> {
  const result = await query<{
    token_ciphertext: string | null;
    token_iv: string | null;
    token_tag: string | null;
  }>(
    `SELECT token_ciphertext, token_iv, token_tag
       FROM connections WHERE provider = $1 AND status = 'connected'`,
    [provider],
  );
  const row = result.rows[0];
  if (
    row === undefined ||
    row.token_ciphertext === null ||
    row.token_iv === null ||
    row.token_tag === null
  ) {
    return null;
  }
  return decryptWithKey(
    { ciphertext: row.token_ciphertext, iv: row.token_iv, tag: row.token_tag },
    encryptionKey(),
  );
}

/** Upsert a connection (one row per provider): encrypt the refresh token and mark it connected. */
export async function upsertConnection(
  input: {
    readonly provider: string;
    readonly refreshToken: string;
    readonly scope: string | null;
    readonly accountLabel: string | null;
    readonly connectedBy: string | null;
  },
  db: Queryable = { query },
): Promise<void> {
  const enc = encryptWithKey(input.refreshToken, encryptionKey());
  await db.query(
    `INSERT INTO connections
       (provider, status, token_ciphertext, token_iv, token_tag, scope, account_label, connected_by)
     VALUES ($1, 'connected', $2, $3, $4, $5, $6, $7)
     ON CONFLICT (provider) DO UPDATE
        SET status = 'connected', token_ciphertext = EXCLUDED.token_ciphertext,
            token_iv = EXCLUDED.token_iv, token_tag = EXCLUDED.token_tag,
            scope = EXCLUDED.scope, account_label = EXCLUDED.account_label,
            connected_by = EXCLUDED.connected_by, updated_at = now()`,
    [
      input.provider,
      enc.ciphertext,
      enc.iv,
      enc.tag,
      input.scope,
      input.accountLabel,
      input.connectedBy,
    ],
  );
}

/** Disconnect: remove the encrypted token (the secret is erased) and flip status. The row is kept
 *  for audit. Returns true if a connected row was found. */
export async function disconnectConnection(
  provider: string,
  db: Queryable = { query },
): Promise<boolean> {
  const result = await db.query(
    `UPDATE connections
        SET status = 'disconnected', token_ciphertext = NULL, token_iv = NULL,
            token_tag = NULL, updated_at = now()
      WHERE provider = $1 AND status = 'connected'`,
    [provider],
  );
  return (result.rowCount ?? 0) > 0;
}
