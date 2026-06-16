// T3/T4 (spec 019) — outbound_webhook_deliveries repository (migration 0019): the audited,
// idempotent ledger behind the distribution webhook. P5 (Safety rails): rows hold delivery
// METADATA only (target, attempts, last status, secret-free error) — never the payload body or
// the signing secret. All queries are parameterised and run-scoped (constitution §2).

import { query, type Queryable } from '@/app/lib/aurora.ts';
import type { DeliveryAttemptOutcome } from '@/app/lib/outboundWebhook.ts';
import type { OutboundDeliveryRow } from '@/app/lib/webhookDeliveryView.ts';

// Re-export the pure view types + summary so callers can keep importing them from the repository
// module; the runtime logic lives in the dependency-free webhookDeliveryView.ts (no aurora import).
export type { OutboundDeliveryRow, OutboundDeliveryTotals } from '@/app/lib/webhookDeliveryView.ts';
export { summarizeOutboundDeliveries } from '@/app/lib/webhookDeliveryView.ts';

export interface EnsureDeliveryInput {
  readonly deliveryId: string;
  readonly releaseRunId: string;
  readonly artifactId: string;
  readonly eventType: string;
  readonly targetUrl: string;
}

/** Atomically CLAIM the ledger row for one delivery for THIS dispatcher. The deterministic
 *  delivery_id is UNIQUE, so concurrent/replayed dispatches land on ONE row; the claim is a single
 *  `UPDATE ... RETURNING` that wins only when the delivery is undelivered AND not already in-flight,
 *  so two dispatchers racing the same approval (per-artifact dispatch vs. the run-level sweep) can
 *  never both POST. `shouldDispatch` is false when the row is already delivered OR another dispatch
 *  claimed it within the lease window. A `last_status = -1` sentinel marks "in flight"; a finished
 *  attempt overwrites it with the real status (or NULL on a network error), and a crashed dispatch's
 *  stale claim is reclaimable after the 2-minute lease — so legitimate retries are preserved
 *  (at-least-once dispatch via the sweep, at-most-once successful POST per delivery id). */
export async function ensureDelivery(
  input: EnsureDeliveryInput,
  db: Queryable = { query },
): Promise<{ readonly shouldDispatch: boolean }> {
  await db.query(
    `INSERT INTO outbound_webhook_deliveries
       (delivery_id, release_run_id, artifact_id, event_type, target_url)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (delivery_id) DO NOTHING`,
    [input.deliveryId, input.releaseRunId, input.artifactId, input.eventType, input.targetUrl],
  );
  const claim = await db.query<{ delivery_id: string }>(
    `UPDATE outbound_webhook_deliveries
        SET last_status = -1, updated_at = now()
      WHERE delivery_id = $1
        AND delivered_at IS NULL
        AND (last_status IS DISTINCT FROM -1 OR updated_at < now() - interval '2 minutes')
      RETURNING delivery_id`,
    [input.deliveryId],
  );
  return { shouldDispatch: claim.rows.length > 0 };
}

/** Record one dispatch outcome on the ledger row: attempts accumulate across dispatches;
 *  delivered_at is set exactly once, on the first success (never cleared by a later failure —
 *  the unique delivery already happened). */
export async function recordDeliveryAttempt(
  deliveryId: string,
  outcome: DeliveryAttemptOutcome,
  db: Queryable = { query },
): Promise<void> {
  await db.query(
    `UPDATE outbound_webhook_deliveries
        SET attempt_count = attempt_count + $2,
            last_status   = $3,
            last_error    = $4,
            delivered_at  = COALESCE(delivered_at, CASE WHEN $5 THEN now() END),
            updated_at    = now()
      WHERE delivery_id = $1`,
    [deliveryId, outcome.attempts, outcome.status, outcome.error, outcome.ok],
  );
}

interface RawOutboundDeliveryRow {
  delivery_id: string;
  release_run_id: string;
  artifact_id: string;
  event_type: string;
  target_url: string;
  // pg returns integers as numbers but be defensive about COUNT-style strings.
  attempt_count: string | number | null;
  last_status: string | number | null;
  last_error: string | null;
  delivered_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

function toIso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function mapOutboundRow(row: RawOutboundDeliveryRow): OutboundDeliveryRow {
  return {
    delivery_id: row.delivery_id,
    release_run_id: row.release_run_id,
    artifact_id: row.artifact_id,
    event_type: row.event_type,
    target_url: row.target_url,
    attempt_count: row.attempt_count === null ? 0 : Math.trunc(Number(row.attempt_count)),
    last_status: row.last_status === null ? null : Math.trunc(Number(row.last_status)),
    last_error: row.last_error,
    delivered_at: toIso(row.delivered_at),
    created_at: toIso(row.created_at) ?? '',
    updated_at: toIso(row.updated_at) ?? '',
  };
}

/** The most recent outbound webhook deliveries across all runs, newest activity first — the
 *  dashboard's delivery-management surface. Bounded by `limit` (no UI pagination over an
 *  unbounded ledger). Reads metadata only; the URL is config the operator set, not a secret. */
export async function listOutboundWebhookDeliveries(
  limit = 100,
  db: Queryable = { query },
): Promise<readonly OutboundDeliveryRow[]> {
  const result = await db.query<RawOutboundDeliveryRow>(
    `SELECT delivery_id, release_run_id, artifact_id, event_type, target_url,
            attempt_count, last_status, last_error, delivered_at, created_at, updated_at
       FROM outbound_webhook_deliveries
      ORDER BY updated_at DESC
      LIMIT $1`,
    [limit],
  );
  return result.rows.map(mapOutboundRow);
}

/** Artifact ids for a run that have an approved snapshot but no successful delivery yet —
 *  the run-level sweep's worklist (Gate #2 "Approve & resume" dispatches any artifact whose
 *  per-artifact dispatch failed or predates webhook configuration). */
export async function listUndeliveredApprovedArtifacts(
  releaseRunId: string,
  eventType: string,
  db: Queryable = { query },
): Promise<readonly string[]> {
  const result = await db.query<{ artifact_id: string }>(
    `SELECT s.artifact_id
       FROM approved_artifact_snapshots s
       LEFT JOIN outbound_webhook_deliveries d
         ON d.artifact_id = s.artifact_id AND d.event_type = $2
      WHERE s.release_run_id = $1
        AND d.delivered_at IS NULL
      ORDER BY s.approved_at ASC
      LIMIT 200`,
    [releaseRunId, eventType],
  );
  return result.rows.map((row) => row.artifact_id);
}
