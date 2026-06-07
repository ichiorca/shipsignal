// T4 (spec 001) — Aurora-backed delivery-GUID dedupe for inbound webhooks.
// github-rules: deliveries are at-least-once, so replay protection must be durable
// across the serverless fleet. A UNIQUE PRIMARY KEY on delivery_guid plus
// INSERT ... ON CONFLICT DO NOTHING makes "first writer wins" atomic — exactly the
// DeliveryGuidStore contract the webhook handler depends on.

import { query } from '@/app/lib/aurora.ts';
import type { DeliveryGuidStore } from '@/app/lib/githubWebhook.ts';

export class AuroraDeliveryGuidStore implements DeliveryGuidStore {
  constructor(private readonly source = 'github') {}

  async markIfNew(deliveryGuid: string): Promise<boolean> {
    const result = await query(
      `INSERT INTO webhook_deliveries (delivery_guid, source)
       VALUES ($1, $2)
       ON CONFLICT (delivery_guid) DO NOTHING`,
      [deliveryGuid, this.source],
    );
    // rowCount === 1 → inserted (new); 0 → conflict (already seen → replay).
    return result.rowCount === 1;
  }
}
