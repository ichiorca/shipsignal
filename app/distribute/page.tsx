// Path B / Phase 1 — Distribute hub. The home for "what shipped, where, and when". Today it links
// to the delivery ledger; Channels (LinkedIn/X connections) and Schedule (send-time) land in
// Phases 3–4 and are shown as roadmap cards so the product reads as intentional, not empty.
// Server Component (no data read yet — the cards are static). P6: SectionHub owns the a11y.

import { PageHeader } from '@/app/components/PageHeader.ts';
import { ChannelStatus } from '@/app/components/ChannelStatus.ts';
import { ScheduleQueue } from '@/app/components/ScheduleQueue.ts';
import { channelStatus } from '@/app/lib/channelDispatch.ts';
import { listUpcomingSchedules } from '@/app/lib/db/scheduledPublishes.ts';

export const dynamic = 'force-dynamic';

export default async function PublishedPage() {
  const [status, schedules] = await Promise.all([
    Promise.resolve(channelStatus()),
    listUpcomingSchedules(),
  ]);
  return (
    <main id="main">
      <PageHeader
        eyebrow="Workflow"
        title="Published"
        description="What shipped and where — channels, send-time schedule, and the delivery ledger."
        actions={<a href="/webhooks">Published &amp; deliveries →</a>}
      />
      <section aria-labelledby="channels-heading" id="channels">
        <h2 id="channels-heading">Channels</h2>
        <p>
          Publish approved posts from a launch&apos;s artifacts. An unconnected channel runs as a
          dry-run until you set its credential.
        </p>
        <ChannelStatus
          linkedinConfigured={status.linkedinConfigured}
          xConfigured={status.xConfigured}
          dryRun={status.dryRun}
          mode={status.mode}
        />
      </section>
      <section aria-labelledby="schedule-heading" id="schedule">
        <h2 id="schedule-heading">Scheduled posts</h2>
        <p>
          Approved posts queued to ship at a chosen time. A GitHub Actions cron drains due posts;
          enable it by setting <code>PUBLISH_MODE=scheduled</code> and the drain secret.
        </p>
        <ScheduleQueue schedules={schedules} />
      </section>
    </main>
  );
}
