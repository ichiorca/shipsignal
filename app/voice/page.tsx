// Reskin (peer parity with hindsight-guild/web Voice.tsx) — the "Brand Voice" view. NOTE: this is
// the COMPANY/FOUNDER brand voice that grounds generation, NOT a customer-voice corpus. ShipSignal
// grounds every draft in the founder's published voice exemplars, the ICP segments it markets to,
// and the approved, evidence-backed messaging claims. This page is read-only: the editable CRUD for
// all three lives at /settings (the "brand & customer brain"). Server Component: reads Aurora
// server-side (no secret/DB handle reaches the client). P6 (WCAG 2.2 AA): one <main> landmark,
// sections render as cards (global CSS), each starts with an <h2>; status is conveyed as text.

import { listVoiceExemplars } from '@/app/lib/db/voiceExemplars.ts';
import { listIcpSegments } from '@/app/lib/db/icpSegments.ts';
import { listMessagingClaims } from '@/app/lib/db/messagingClaims.ts';
import { PageHeader } from '@/app/components/PageHeader.ts';
import { humanizeStatus } from '@/app/lib/displayFormat.ts';

export const dynamic = 'force-dynamic';

export default async function BrandVoicePage() {
  const [exemplars, icpSegments, claims] = await Promise.all([
    listVoiceExemplars(),
    listIcpSegments(),
    listMessagingClaims(),
  ]);

  return (
    <main id="main">
      <PageHeader
        eyebrow="Skill library"
        title="Brand Voice"
        description="The company/founder voice every draft is grounded in."
        actions={<a href="/settings">Edit in settings</a>}
      />

      <section aria-labelledby="exemplars-heading">
        <h2 id="exemplars-heading">Voice exemplars</h2>
        <p>
          {exemplars.length === 0
            ? 'No voice exemplars yet. Add the founder’s published posts in settings so generation can match your voice.'
            : `${
                exemplars.length === 1 ? '1 exemplar' : `${exemplars.length} exemplars`
              } of the founder’s own published content. The worker embeds each one so retrieval can ground a draft in your actual voice.`}
        </p>
        {exemplars.length > 0 ? (
          <ul>
            {exemplars.map((exemplar) => (
              <li key={exemplar.id}>
                <h3>{exemplar.title === '' ? 'Untitled exemplar' : exemplar.title}</h3>
                <p>
                  Channel: {exemplar.channel}
                  {exemplar.source !== null && exemplar.source !== '' ? (
                    <> · Source: {exemplar.source}</>
                  ) : null}{' '}
                  · {exemplar.embedded ? 'Embedded' : 'Embedding pending'}
                </p>
                <blockquote>{exemplar.body_text}</blockquote>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section aria-labelledby="icp-heading">
        <h2 id="icp-heading">Audience (ICP segments)</h2>
        <p>
          {icpSegments.length === 0
            ? 'No ICP segments defined yet. Define who you market to in settings.'
            : 'Who the voice speaks to. Generation grounds against the active segments below.'}
        </p>
        {icpSegments.length > 0 ? (
          <ul>
            {icpSegments.map((segment) => (
              <li key={segment.id}>
                <h3>{segment.name}</h3>
                <p>Status: {humanizeStatus(segment.status)}</p>
                {segment.description !== '' ? <p>{segment.description}</p> : null}
                {segment.buyer_roles.length > 0 ? (
                  <p>Buyer roles: {segment.buyer_roles.join(', ')}</p>
                ) : null}
                {segment.pain_points.length > 0 ? (
                  <p>Pain points: {segment.pain_points.join(', ')}</p>
                ) : null}
                {segment.approved_angles.length > 0 ? (
                  <p>Approved angles: {segment.approved_angles.join(', ')}</p>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section aria-labelledby="claims-heading">
        <h2 id="claims-heading">Approved messaging</h2>
        <p>
          {claims.length === 0
            ? 'No messaging claims yet. Add approved, evidence-backed claims in settings.'
            : 'The approved, evidence-backed claims generation may make — each scoped to the ICP segments it applies to.'}
        </p>
        {claims.length > 0 ? (
          <table>
            <caption>Messaging claims with type, status, and applicable ICP segments.</caption>
            <thead>
              <tr>
                <th scope="col">Claim</th>
                <th scope="col">Type</th>
                <th scope="col">Status</th>
                <th scope="col">Applies to</th>
              </tr>
            </thead>
            <tbody>
              {claims.map((claim) => (
                <tr key={claim.id}>
                  <th scope="row">
                    {claim.evidence_url !== null && claim.evidence_url !== '' ? (
                      <a href={claim.evidence_url}>{claim.claim_text}</a>
                    ) : (
                      claim.claim_text
                    )}
                  </th>
                  <td>{humanizeStatus(claim.claim_type)}</td>
                  <td>{humanizeStatus(claim.status)}</td>
                  <td>
                    {claim.applies_to_icp.length === 0
                      ? 'All segments'
                      : claim.applies_to_icp.join(', ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </section>

      <section aria-labelledby="edit-heading">
        <h2 id="edit-heading">Editing the brand voice</h2>
        <p>
          This page is read-only. To add, edit, or archive voice exemplars, ICP segments, and
          messaging claims, open <a href="/settings">settings</a> — the brand &amp; audience brain.
        </p>
      </section>
    </main>
  );
}
