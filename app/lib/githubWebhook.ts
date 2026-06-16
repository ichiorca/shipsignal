// T4 (spec 001) — GitHub webhook authentication + replay protection.
// P5 (Safety rails) + github-rules: verify every inbound webhook over the RAW body
// with a constant-time HMAC compare, and dedupe deliveries (GitHub is at-least-once)
// on the delivery GUID so a replay can never create a second release_run.
//
// This module is intentionally pure (node:crypto only) so the 401/replay acceptance
// criteria are unit-tested against the exact surface the route handler calls.

import { createHmac, timingSafeEqual } from 'node:crypto';
// Type-only import (erased at compile time) — keeps this module runtime-pure (node:crypto only)
// while letting the DeliveryGuidStore contract name the optional transaction client honestly.
import type { Queryable } from '@/app/lib/aurora.ts';

/** Result of authenticating a raw webhook delivery. */
export type WebhookAuth =
  | { readonly ok: true }
  | { readonly ok: false; readonly status: 401; readonly reason: string };

/**
 * Verify GitHub's `X-Hub-Signature-256` header against the raw request body.
 *
 * @param rawBody  the EXACT bytes GitHub sent (never the re-serialized JSON — a
 *                 re-encode changes key order/whitespace and breaks the HMAC).
 * @param signatureHeader  the `sha256=<hex>` header value (or null if absent).
 * @param secret  the shared webhook secret from env (never hardcoded/logged).
 */
export function verifyGithubSignature(
  rawBody: string | Buffer,
  signatureHeader: string | null | undefined,
  secret: string,
): WebhookAuth {
  if (!secret) {
    // Misconfiguration is a server fault, but surfacing 401 (not 500) avoids leaking
    // that the secret is unset and keeps unsigned traffic uniformly rejected.
    return { ok: false, status: 401, reason: 'webhook secret not configured' };
  }
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) {
    return { ok: false, status: 401, reason: 'missing or malformed signature header' };
  }

  const body = typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf8') : rawBody;
  const expected = createHmac('sha256', secret).update(body).digest('hex');
  const expectedBuf = Buffer.from(`sha256=${expected}`, 'utf8');
  const providedBuf = Buffer.from(signatureHeader, 'utf8');

  // Length check first: timingSafeEqual throws on unequal lengths.
  if (expectedBuf.length !== providedBuf.length) {
    return { ok: false, status: 401, reason: 'signature mismatch' };
  }
  if (!timingSafeEqual(expectedBuf, providedBuf)) {
    return { ok: false, status: 401, reason: 'signature mismatch' };
  }
  return { ok: true };
}

/**
 * Idempotency store for delivery GUIDs (`X-GitHub-Delivery`). The skeleton uses an
 * in-process implementation for tests/local; production backs this with a uniquely
 * -constrained Aurora table so dedupe survives across the serverless fleet.
 */
export interface DeliveryGuidStore {
  /**
   * Atomically record the GUID. Returns false if it was already present (replay).
   * `db` is optional so a caller can run the dedupe inside an existing transaction (the Aurora
   * implementation honours it); in-memory stores ignore it. Declared on the interface so the
   * transaction client can be threaded through a `DeliveryGuidStore`-typed reference.
   */
  markIfNew(deliveryGuid: string, db?: Queryable): Promise<boolean> | boolean;
}

/** In-memory dedupe store. Exposed for tests and single-process/dev use only. */
export class InMemoryDeliveryGuidStore implements DeliveryGuidStore {
  private readonly seen = new Set<string>();

  markIfNew(deliveryGuid: string): boolean {
    if (this.seen.has(deliveryGuid)) {
      return false;
    }
    this.seen.add(deliveryGuid);
    return true;
  }
}

/** A release-tag delivery reduced to the fields the run-creation needs. */
export interface ReleaseTagDelivery {
  readonly repo: string;
  readonly tag: string;
  readonly previousTag: string | null;
}

/**
 * Extract the compare range from a `release` webhook payload. Returns null when the
 * payload is not a usable published-release event (caller responds 2xx + ignores, so
 * GitHub doesn't redeliver). All field access treats the payload as untrusted.
 */
export function extractReleaseTagDelivery(payload: unknown): ReleaseTagDelivery | null {
  if (typeof payload !== 'object' || payload === null) {
    return null;
  }
  const root = payload as Record<string, unknown>;
  const repository = root['repository'];
  const release = root['release'];
  if (typeof repository !== 'object' || repository === null) return null;
  if (typeof release !== 'object' || release === null) return null;

  const repo = (repository as Record<string, unknown>)['full_name'];
  const tag = (release as Record<string, unknown>)['tag_name'];
  if (typeof repo !== 'string' || typeof tag !== 'string') return null;
  if (repo.length === 0 || tag.length === 0) return null;

  return { repo, tag, previousTag: null };
}
