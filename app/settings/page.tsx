// Brand & customer settings (migration 0025 / PO gap): the configuration surface that was
// missing — who you market to (ICP), your company voice (the embedded corpus), and your approved
// messaging. Generation grounds every artifact in this. Server Component: reads Aurora server-side
// and renders the client editors. P6 (WCAG 2.2 AA): one <main> landmark, headed sections.

import { listIcpSegments } from '@/app/lib/db/icpSegments.ts';
import { listVoiceExemplars } from '@/app/lib/db/voiceExemplars.ts';
import { listMessagingClaims } from '@/app/lib/db/messagingClaims.ts';
import { IcpSettings } from '@/app/components/IcpSettings.ts';
import { VoiceExemplarSettings } from '@/app/components/VoiceExemplarSettings.ts';
import { MessagingSettings } from '@/app/components/MessagingSettings.ts';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const [segments, exemplars, claims] = await Promise.all([
    listIcpSegments(),
    listVoiceExemplars(),
    listMessagingClaims(),
  ]);

  return (
    <main id="main">
      <nav aria-label="Breadcrumb">
        <a href="/">← All launches</a>
      </nav>
      <h1>Brand &amp; customer settings</h1>
      <p>
        Configure who you market to, your company voice, and your approved messaging. Every
        generated artifact is grounded in this — your ICP, your voice, your positioning — so the
        output sounds like you and speaks to your customers.
      </p>

      <section aria-labelledby="icp-heading">
        <h2 id="icp-heading">ICP segments</h2>
        <p>
          The customers you market to. Their pains, objections, and approved angles ground every
          draft and the audience-relevance eval.
        </p>
        <IcpSettings segments={segments} />
      </section>

      <section aria-labelledby="voice-heading">
        <h2 id="voice-heading">Company voice</h2>
        <p>
          Paste your real published content (past blogs, posts, emails). The worker embeds each
          exemplar; at generation time the closest ones to the release are retrieved and used as
          style references — this is how output matches <em>your</em> voice, not a generic tone.
        </p>
        <VoiceExemplarSettings exemplars={exemplars} segments={segments} />
      </section>

      <section aria-labelledby="messaging-heading">
        <h2 id="messaging-heading">Messaging library</h2>
        <p>
          Approved, evidence-backed value props and positioning, scoped by ICP. Generation may use
          the approved set for the target segment; the claim/check node can defend them.
        </p>
        <MessagingSettings claims={claims} segments={segments} />
      </section>
    </main>
  );
}
