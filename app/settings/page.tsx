// Brand & customer settings (migration 0025 / PO gap): the audience + positioning configuration —
// who you market to (ICP) and your approved messaging. The company VOICE (voice guide + exemplars)
// moved to its own authoring module at /voice (operator decision 2026-06-22), so it is not
// duplicated here. Generation grounds every artifact in all of these. Server Component: reads Aurora
// server-side and renders the client editors. P6 (WCAG 2.2 AA): one <main> landmark, headed sections.

import { listIcpSegments } from '@/app/lib/db/icpSegments.ts';
import { listMessagingClaims } from '@/app/lib/db/messagingClaims.ts';
import { IcpSettings } from '@/app/components/IcpSettings.ts';
import { MessagingSettings } from '@/app/components/MessagingSettings.ts';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const [segments, claims] = await Promise.all([listIcpSegments(), listMessagingClaims()]);

  return (
    <main id="main">
      <nav aria-label="Breadcrumb">
        <a href="/">← All launches</a>
      </nav>
      <h1>Brand &amp; customer settings</h1>
      <p>
        Configure who you market to and the approved messaging generation may use. Your company
        voice — the brand language every draft is written in — is authored on the{' '}
        <a href="/voice">Brand Voice</a> page.
      </p>

      <section aria-labelledby="icp-heading">
        <h2 id="icp-heading">ICP segments</h2>
        <p>
          The customers you market to. Their pains, objections, and approved angles ground every
          draft and the audience-relevance eval.
        </p>
        <IcpSettings segments={segments} />
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
