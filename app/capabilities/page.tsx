// Reskin (peer parity with hindsight-guild/web Capabilities.tsx) — the "Capabilities" view.
// ShipSignal's capabilities are the artifact types the engine can produce; each is grounded by a
// resolved set of skills (its format skill + brand-voice, peer-parity with the agent→skill
// allowlist). This page shows AND lets operators edit the capability→skill mapping (migration 0032):
// add/remove a grounding skill per capability, persisted as an operator override the worker resolves
// at generation time. The raw skill library + usage live on /skills. Server Component: reads Aurora
// server-side (no secret/DB handle reaches the client) and renders the client editor. P6 (WCAG 2.2
// AA): one <main> landmark, headed sections, labelled controls, polite status.

import { listCapabilitySkills } from '@/app/lib/db/capabilitySkills.ts';
import { listSkills } from '@/app/lib/db/skills.ts';
import { PageHeader } from '@/app/components/PageHeader.ts';
import { CapabilitySkillsEditor } from '@/app/components/CapabilitySkillsEditor.ts';

export const dynamic = 'force-dynamic';

export default async function CapabilitiesPage() {
  const [capabilities, skills] = await Promise.all([listCapabilitySkills(), listSkills()]);
  const availableSkills = skills.map((s) => s.skill_name).sort((a, b) => a.localeCompare(b));

  return (
    <main id="main">
      <PageHeader
        eyebrow="Skill library"
        title="Capabilities"
        description="What the engine can produce, and which skills ground each capability — editable."
      />

      <section aria-labelledby="mapping-heading">
        <h2 id="mapping-heading">Capability → skill mapping</h2>
        <p>
          {capabilities.length === 0
            ? 'No capability mapping is seeded yet — run the reference seeder (it loads the ' +
              'code-default mapping) and each artifact type and the skills that ground it appear here.'
            : 'Which skills ground each capability (artifact type). The worker resolves this exact ' +
              'mapping at generation time — an operator edit wins per capability, otherwise the seeded ' +
              'code default applies. Add or remove a skill below; the skills themselves (versions, ' +
              'history, usage) live in the '}
          {capabilities.length === 0 ? null : <a href="/skills">skill library</a>}
          {capabilities.length === 0 ? null : '. Removing every skill from a capability reverts it to the code default.'}
        </p>
        {capabilities.length > 0 ? (
          <CapabilitySkillsEditor capabilities={capabilities} availableSkills={availableSkills} />
        ) : null}
      </section>
    </main>
  );
}
