// Frontend audit — pure view types + summary for the webhook delivery dashboard. Kept free of any
// `server-only`/`pg` import (unlike app/lib/db/*) so the presentational component and its
// dependency-free `node --test` a11y harness can import the types and `summarizeOutboundDeliveries`
// without dragging in the Aurora client — mirroring the cost.ts / evalMetrics.ts split.
//
// constitution §5: these shapes carry delivery METADATA only — target (operator config), event
// type, attempt count, HTTP status, a secret-free error string, timestamps — never a payload or
// signing secret.

/** One outbound-delivery ledger row as the dashboard renders it. */
export interface OutboundDeliveryRow {
  readonly delivery_id: string;
  readonly release_run_id: string;
  readonly artifact_id: string;
  readonly event_type: string;
  readonly target_url: string;
  readonly attempt_count: number;
  readonly last_status: number | null;
  readonly last_error: string | null;
  readonly delivered_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

/** One inbound delivery-dedupe row as the dashboard renders it. */
export interface InboundDeliveryRow {
  readonly delivery_guid: string;
  readonly source: string;
  readonly received_at: string;
}

/** delivered / failed / pending counts for the dashboard summary strip. */
export interface OutboundDeliveryTotals {
  readonly total: number;
  readonly delivered: number;
  readonly failed: number;
  readonly pending: number;
}

/** True when an HTTP status is outside the 2xx success range. */
function isFailureStatus(status: number | null): boolean {
  return status !== null && (status < 200 || status >= 300);
}

/** The delivery state buckets, shared by the summary and the per-row badge so they never drift:
 *  delivered when delivered_at is set; else failed on a non-2xx last_status; else pending. */
export function deliveryState(row: OutboundDeliveryRow): 'delivered' | 'failed' | 'pending' {
  if (row.delivered_at !== null) return 'delivered';
  if (isFailureStatus(row.last_status)) return 'failed';
  return 'pending';
}

export function summarizeOutboundDeliveries(
  rows: readonly OutboundDeliveryRow[],
): OutboundDeliveryTotals {
  let delivered = 0;
  let failed = 0;
  for (const row of rows) {
    const state = deliveryState(row);
    if (state === 'delivered') delivered += 1;
    else if (state === 'failed') failed += 1;
  }
  return { total: rows.length, delivered, failed, pending: rows.length - delivered - failed };
}
