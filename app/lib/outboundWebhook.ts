// T3/T4 (spec 019) — outbound distribution webhook: payload, signing, idempotent delivery ids,
// bounded retry (pure logic; unit-tested; the DB ledger + fetch wiring live in
// app/lib/db/outboundWebhookDeliveries.ts and app/lib/outboundDispatch.ts).
//
// P5 (Safety rails) / security-baseline + vercel/github webhook rules applied OUTBOUND:
//  - HMAC-SHA256 over `${timestamp}.${rawBody}` (raw bytes, never re-parsed JSON), so consumers
//    can verify integrity AND bound replay by timestamp — mirroring the ElevenLabs scheme this
//    repo already verifies inbound.
//  - The payload is assembled ONLY from the §18.1 approved snapshot and carries no reviewer
//    identity, no evidence excerpts, no secrets (the spec's data-minimization AC).
//  - Config comes from server env at call time (never NEXT_PUBLIC_*, never logged); a URL
//    without its secret fails fast rather than shipping unsigned content.
//  - delivery ids are DETERMINISTIC per (event, artifact), so at-least-once dispatch (route
//    retry + run-level sweep) dedupes in the ledger and consumers can dedupe too.

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { ApprovedSnapshotView } from './artifactExport.ts';

export const ARTIFACT_APPROVED_EVENT = 'artifact.approved';

export interface OutboundWebhookConfig {
  readonly url: string;
  readonly secret: string;
}

/** Read the outbound webhook config. Unset URL → null (the feature is off, per the AC).
 *  A URL without a secret is a misconfiguration — fail fast, never POST unsigned. */
export function getOutboundWebhookConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): OutboundWebhookConfig | null {
  const url = env['OUTBOUND_WEBHOOK_URL'] ?? '';
  if (url === '') return null;
  const secret = env['OUTBOUND_WEBHOOK_SECRET'] ?? '';
  if (secret === '') {
    // Names the missing var; never echoes any value.
    throw new Error(
      'OUTBOUND_WEBHOOK_URL is set but OUTBOUND_WEBHOOK_SECRET is missing: refusing to send ' +
        'unsigned webhooks',
    );
  }
  return { url, secret };
}

/** Deterministic delivery id for (event, artifact): the same approval can be dispatched
 *  many times (route retry, sweep) but always lands on ONE ledger row / consumer dedupe key. */
export function deliveryIdFor(eventType: string, artifactId: string): string {
  return createHmac('sha256', 'shipsignal-delivery-id').update(`${eventType}:${artifactId}`).digest('hex');
}

/** The outbound payload: approved content + provenance, NO reviewer identity (data
 *  minimization — the approval is auditable internally via the snapshot/approvals tables). */
export interface ArtifactApprovedPayload {
  readonly event: typeof ARTIFACT_APPROVED_EVENT;
  readonly delivery_id: string;
  readonly release_run_id: string;
  readonly artifact_id: string;
  readonly artifact_type: string;
  readonly final_title: string | null;
  readonly final_body_markdown: string;
  readonly content_hash: string;
  readonly approved_at: string | null;
}

export function buildArtifactApprovedPayload(
  snapshot: ApprovedSnapshotView,
  deliveryId: string,
): ArtifactApprovedPayload {
  return {
    event: ARTIFACT_APPROVED_EVENT,
    delivery_id: deliveryId,
    release_run_id: snapshot.release_run_id,
    artifact_id: snapshot.artifact_id,
    artifact_type: snapshot.artifact_type,
    final_title: snapshot.final_title,
    final_body_markdown: snapshot.final_body_markdown,
    content_hash: snapshot.content_hash,
    approved_at: snapshot.approved_at,
  };
}

/** Sign `${timestamp}.${rawBody}` with HMAC-SHA256 → `sha256=<hex>`. */
export function signWebhookBody(secret: string, timestamp: string, rawBody: string): string {
  return `sha256=${createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')}`;
}

/** Constant-time verification for consumers (documented in docs/distribution.md; also keeps
 *  the signing scheme honest in tests — sign + verify must round-trip). */
export function verifyWebhookSignature(
  secret: string,
  timestamp: string,
  rawBody: string,
  signature: string,
): boolean {
  const expected = Buffer.from(signWebhookBody(secret, timestamp, rawBody));
  const received = Buffer.from(signature);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

/** Header names, exported so dispatch + docs + tests never drift. */
export const DELIVERY_HEADER = 'x-shipsignal-delivery';
export const TIMESTAMP_HEADER = 'x-shipsignal-timestamp';
export const SIGNATURE_HEADER = 'x-shipsignal-signature';

export interface DeliveryAttemptOutcome {
  readonly ok: boolean;
  /** Last HTTP status seen, or null when every attempt failed before a response. */
  readonly status: number | null;
  /** Secret-free, payload-free error description for the audit ledger. */
  readonly error: string | null;
  readonly attempts: number;
}

interface RetryOptions {
  readonly maxAttempts?: number;
  readonly baseDelayMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** A response status is retryable when the failure can be transient: 5xx or 429. Any other
 *  4xx is a consumer/config problem — retrying would just hammer it; record and stop. */
function isRetryableStatus(status: number): boolean {
  return status >= 500 || status === 429;
}

/** Run `send` with bounded exponential backoff. Never throws — the outcome (including a
 *  secret-free error string) goes to the delivery ledger; a webhook failure must never fail
 *  the approval that triggered it (the spec's graceful-degradation AC). */
export async function postWithRetry(
  send: () => Promise<{ status: number }>,
  { maxAttempts = 3, baseDelayMs = 500, sleep = defaultSleep }: RetryOptions = {},
): Promise<DeliveryAttemptOutcome> {
  let lastStatus: number | null = null;
  let lastError: string | null = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (attempt > 1) await sleep(baseDelayMs * 2 ** (attempt - 2));
    try {
      const response = await send();
      lastStatus = response.status;
      if (response.status >= 200 && response.status < 300) {
        return { ok: true, status: response.status, error: null, attempts: attempt };
      }
      lastError = `endpoint responded ${response.status}`;
      if (!isRetryableStatus(response.status)) {
        return { ok: false, status: response.status, error: lastError, attempts: attempt };
      }
    } catch (err) {
      // Network-level failure: keep a class-of-error message only (no URL, no payload).
      // err.name (the class, e.g. "TypeError") NOT err.message — the message can contain the target
      // URL/secret (constitution §5: no secrets in the DB ledger or logs). Diagnosability is traded
      // for secret-hygiene here deliberately; the audit ledger keeps only the class of failure.
      lastError = err instanceof Error ? `request failed: ${err.name}` : 'request failed';
    }
  }
  return { ok: false, status: lastStatus, error: lastError, attempts: maxAttempts };
}
