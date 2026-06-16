// /live — "Live Ops" in the reskinned "Signals & Trends" section, mirroring hindsight-guild's Live
// route. Two real signals: (a) launches running right now — release_runs whose status groups to
// 'in_progress' or 'awaiting' (a reviewer gate) — and (b) what's shipping now — the outbound
// distribution-webhook ledger + inbound GitHub activity, reusing the WebhookDeliveries component.
// Server Component: reads Aurora server-side (no secret/DB handle reaches the client). P6 (WCAG
// 2.2 AA): one <main> landmark; PageHeader title is the page <h1>; the running list is a captioned
// semantic table (state conveyed as text, colour an enhancement); deliveries reuse the accessible
// WebhookDeliveries tables.

import { listReleaseRuns } from '@/app/lib/db/releaseRuns.ts';
import {
  listOutboundWebhookDeliveries,
  summarizeOutboundDeliveries,
} from '@/app/lib/db/outboundWebhookDeliveries.ts';
import { listInboundWebhookDeliveries } from '@/app/lib/db/webhookDeliveries.ts';
import { statusCategory, STATUS_CATEGORY_LABEL, nextStep } from '@/app/lib/runProgress.ts';
import { humanizeStatus, formatTimestamp, relativeTime } from '@/app/lib/displayFormat.ts';
import { WebhookDeliveries } from '@/app/components/WebhookDeliveries.ts';
import { PageHeader } from '@/app/components/PageHeader.ts';

// Always reflect what is running and shipping right now.
export const dynamic = 'force-dynamic';

export default async function LivePage() {
  const [runs, outbound, inbound] = await Promise.all([
    listReleaseRuns(50),
    listOutboundWebhookDeliveries(),
    listInboundWebhookDeliveries(),
  ]);
  const totals = summarizeOutboundDeliveries(outbound);

  // Non-terminal launches: actively progressing or halted at a human gate.
  const runningNow = runs.filter((run) => {
    const category = statusCategory(run.status);
    return category === 'in_progress' || category === 'awaiting';
  });

  return (
    <main id="main">
      <PageHeader
        eyebrow="Signals & Trends"
        title="Live Ops"
        description="What's running and shipping right now."
      />

      <section aria-labelledby="running-now-heading">
        <h2 id="running-now-heading">Running now</h2>
        <p>
          {runningNow.length === 0
            ? 'Nothing in flight — every launch is complete, failed, or cancelled.'
            : `${runningNow.length === 1 ? '1 launch is' : `${runningNow.length} launches are`} in progress or waiting on a reviewer.`}
        </p>
        <table>
          <caption>Launches in flight</caption>
          <thead>
            <tr>
              <th scope="col">Launch</th>
              <th scope="col">Repository</th>
              <th scope="col">Stage</th>
              <th scope="col">Next step</th>
              <th scope="col">Started</th>
            </tr>
          </thead>
          <tbody>
            {runningNow.length === 0 ? (
              <tr>
                <td colSpan={5}>No launches are running right now.</td>
              </tr>
            ) : (
              runningNow.map((run) => {
                const category = statusCategory(run.status);
                const step = nextStep(run);
                return (
                  <tr key={run.id}>
                    <th scope="row">
                      <a href={`/releases/${run.id}`} title={run.id}>
                        <code>{run.id.slice(0, 8)}…</code>
                      </a>
                    </th>
                    <td>
                      <code>{run.repo}</code>
                    </td>
                    <td data-status={category} data-status-category={category}>
                      <span>{STATUS_CATEGORY_LABEL[category]}</span>
                      {' — '}
                      {humanizeStatus(run.status)}
                    </td>
                    <td>{step === null ? 'Working…' : <a href={step.href}>{step.label}</a>}</td>
                    <td>
                      <time dateTime={run.started_at} title={formatTimestamp(run.started_at)}>
                        {relativeTime(run.started_at)}
                      </time>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </section>

      <section aria-labelledby="shipping-now-heading">
        <h2 id="shipping-now-heading">What's shipping now</h2>
        <p>
          Outbound distribution deliveries and inbound GitHub activity. Counts cover the most recent{' '}
          {outbound.length === 1 ? '1 delivery' : `${outbound.length} deliveries`}.
        </p>
        <WebhookDeliveries outbound={outbound} inbound={inbound} totals={totals} />
      </section>
    </main>
  );
}
