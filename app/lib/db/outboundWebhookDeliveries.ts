// T3/T4 (spec 019) — outbound_webhook_deliveries repository (migration 0019): the audited,
// idempotent ledger behind the distribution webhook. P5 (Safety rails): rows hold delivery
// METADATA only (target, attempts, last status, secret-free error) — never the payload body or
// the signing secret. All queries are parameterised and run-scoped (constitution §2).

import { query, type Queryable } from '@/app/lib/aurora.ts';
import type { DeliveryAttemptOutcome } from '@/app/lib/outboundWebhook.ts';

export interface EnsureDeliveryInput {
  readonly deliveryId: string;
  readonly releaseRunId: string;
  readonly artifactId: string;
  readonly eventType: string;
  readonly targetUrl: string;
}

/** Claim (or re-read) the ledger row for one delivery. Idempotent: the deterministic
 *  delivery_id is UNIQUE, so concurrent/replayed dispatches land on ONE row. Returns whether
 *  the delivery has already succeeded — the caller skips the POST entirely in that case
 *  (at-least-once dispatch, at-most-once successful send per delivery id). */
export async function ensureDelivery(
  input: EnsureDeliveryInput,
  db: Queryable = { query },
): Promise<{ readonly alreadyDelivered: boolean }> {
  await db.query(
    `INSERT INTO outbound_webhook_deliveries
       (delivery_id, release_run_id, artifact_id, event_type, target_url)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (delivery_id) DO NOTHING`,
    [input.deliveryId, input.releaseRunId, input.artifactId, input.eventType, input.targetUrl],
  );
  const existing = await db.query<{ delivered_at: string | Date | null }>(
    `SELECT delivered_at FROM outbound_webhook_deliveries WHERE delivery_id = $1`,
    [input.deliveryId],
  );
  return { alreadyDelivered: (existing.rows[0]?.delivered_at ?? null) !== null };
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
      ORDER BY s.approved_at ASC`,
    [releaseRunId, eventType],
  );
  return result.rows.map((row) => row.artifact_id);
}
