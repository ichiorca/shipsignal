// Frontend audit — webhook delivery dashboard page. Surfaces the previously UI-less outbound
// distribution-webhook ledger and inbound dedupe log so an operator can SEE delivery health
// (delivered / failed / pending) and act on failures, instead of the data living only in Aurora.
// Server Component: reads Aurora server-side (no secret or DB handle reaches the client) and
// renders the accessible WebhookDeliveries tables. P6 (WCAG 2.2 AA): one <main> landmark +
// heading. constitution §5: only delivery metadata is read (see the db reads + component).

import {
  listOutboundWebhookDeliveries,
  summarizeOutboundDeliveries,
} from '@/app/lib/db/outboundWebhookDeliveries.ts';
import { listInboundWebhookDeliveries } from '@/app/lib/db/webhookDeliveries.ts';
import { WebhookDeliveries } from '@/app/components/WebhookDeliveries.ts';

// Always reflect the latest delivery activity.
export const dynamic = 'force-dynamic';

export default async function WebhooksPage() {
  const [outbound, inbound] = await Promise.all([
    listOutboundWebhookDeliveries(),
    listInboundWebhookDeliveries(),
  ]);
  const totals = summarizeOutboundDeliveries(outbound);

  return (
    <main id="main">
      <h1>Webhook deliveries</h1>
      <p>
        Distribution (outbound) deliveries and inbound GitHub activity. Counts cover the most
        recent {outbound.length === 1 ? '1 delivery' : `${outbound.length} deliveries`}.
      </p>
      <WebhookDeliveries outbound={outbound} inbound={inbound} totals={totals} />
    </main>
  );
}
