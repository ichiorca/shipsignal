// T4 (spec 001) — Aurora-backed delivery-GUID dedupe for inbound webhooks.
// github-rules: deliveries are at-least-once, so replay protection must be durable
// across the serverless fleet. A UNIQUE PRIMARY KEY on delivery_guid plus
// INSERT ... ON CONFLICT DO NOTHING makes "first writer wins" atomic — exactly the
// DeliveryGuidStore contract the webhook handler depends on.

import { query, type Queryable } from '@/app/lib/aurora.ts';
import type { DeliveryGuidStore } from '@/app/lib/githubWebhook.ts';
import type { InboundDeliveryRow } from '@/app/lib/webhookDeliveryView.ts';

// Re-export the pure view type so callers can import it from the repository module; the shape
// itself lives in the dependency-free webhookDeliveryView.ts (no aurora import).
export type { InboundDeliveryRow } from '@/app/lib/webhookDeliveryView.ts';

export class AuroraDeliveryGuidStore implements DeliveryGuidStore {
  constructor(private readonly source = 'github') {}

  // `db` lets the caller run the dedupe inside the same transaction as the run insert, so the
  // delivery GUID is only durably recorded if the run is created (a crash in between lets
  // GitHub's redelivery recreate the run rather than silently dropping it).
  async markIfNew(deliveryGuid: string, db: Queryable = { query }): Promise<boolean> {
    const result = await db.query(
      `INSERT INTO webhook_deliveries (delivery_guid, source)
       VALUES ($1, $2)
       ON CONFLICT (delivery_guid) DO NOTHING`,
      [deliveryGuid, this.source],
    );
    // rowCount === 1 → inserted (new); 0 → conflict (already seen → replay). `pg` types
    // rowCount as `number | null`; coalesce so a null can never masquerade as "not inserted"
    // and silently drop a genuinely new delivery.
    return (result.rowCount ?? 0) === 1;
  }
}

interface RawInboundDeliveryRow {
  delivery_guid: string;
  source: string;
  received_at: Date | string;
}

/** The most recent inbound webhook deliveries the system has accepted (and deduped), newest
 *  first — the "what has GitHub sent us" activity log. Bounded by `limit`. */
export async function listInboundWebhookDeliveries(
  limit = 100,
  db: Queryable = { query },
): Promise<readonly InboundDeliveryRow[]> {
  const result = await db.query<RawInboundDeliveryRow>(
    `SELECT delivery_guid, source, received_at
       FROM webhook_deliveries
      ORDER BY received_at DESC
      LIMIT $1`,
    [limit],
  );
  return result.rows.map((row) => ({
    delivery_guid: row.delivery_guid,
    source: row.source,
    received_at: row.received_at instanceof Date ? row.received_at.toISOString() : row.received_at,
  }));
}
