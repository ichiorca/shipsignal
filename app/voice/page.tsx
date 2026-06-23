// Brand Voice — the authoring module for the company's own brand language. This is the COMPANY/
// FOUNDER voice that grounds generation, NOT a customer-voice corpus. It is editable here (operator
// decision 2026-06-22): the brand voice is configurable knowledge, so this page IS where you author
// it — a structured voice guide (tone, reading level, do/don't rules, preferred/avoided vocabulary)
// plus the example posts the worker embeds and retrieves per release. Audience (ICP) and the
// messaging library live on /settings; the voice itself lives here (no duplication). Server
// Component: reads Aurora server-side (no secret/DB handle reaches the client) and renders the
// client editors. P6 (WCAG 2.2 AA): one <main> landmark; each section starts with an <h2>; the
// editors are labelled, keyboard-operable, and report status politely.

import { getVoiceGuide } from '@/app/lib/db/voiceGuide.ts';
import { listVoiceExemplars } from '@/app/lib/db/voiceExemplars.ts';
import { listIcpSegments } from '@/app/lib/db/icpSegments.ts';
import { PageHeader } from '@/app/components/PageHeader.ts';
import { VoiceGuideSettings } from '@/app/components/VoiceGuideSettings.ts';
import { VoiceExemplarSettings } from '@/app/components/VoiceExemplarSettings.ts';

export const dynamic = 'force-dynamic';

export default async function BrandVoicePage() {
  const [guide, exemplars, segments] = await Promise.all([
    getVoiceGuide(),
    listVoiceExemplars(),
    listIcpSegments(),
  ]);

  return (
    <main id="main">
      <PageHeader
        eyebrow="Settings"
        title="Brand Voice"
        description="Your company's own brand language — the voice every generated draft is written in. Author it here; generation grounds in it directly."
        actions={<a href="/admin">← Admin</a>}
      />

      <section aria-labelledby="guide-heading">
        <h2 id="guide-heading">Voice guide</h2>
        <p>
          The rules that define how you sound: tone, reading level, what to always do, what to never
          do, and the words you prefer or avoid. Every draft is generated against this guide.
        </p>
        <VoiceGuideSettings guide={guide} />
      </section>

      <section aria-labelledby="exemplars-heading">
        <h2 id="exemplars-heading">Voice exemplars</h2>
        <p>
          Paste your real published content (past blogs, posts, emails). The worker embeds each one;
          at generation time the closest to the release are retrieved as live style references — this
          is how output matches <em>your</em> voice, not a generic tone. Examples complement the
          guide above: the guide states the rules, the exemplars show them in practice.
        </p>
        <VoiceExemplarSettings exemplars={exemplars} segments={segments} />
      </section>

      <section aria-labelledby="related-heading">
        <h2 id="related-heading">Audience &amp; messaging</h2>
        <p>
          Who this voice speaks to (ICP segments) and the approved, evidence-backed claims it may
          make live in <a href="/settings">brand &amp; customer settings</a>.
        </p>
      </section>
    </main>
  );
}
