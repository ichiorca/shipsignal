// Reskin (peer parity with hindsight-guild/web Capabilities.tsx) — the "Capabilities" view.
// ShipSignal's capabilities are the artifact types the engine can produce; each is grounded by a
// resolved set of skills (its format skill + brand-voice, peer-parity with the agent→skill
// allowlist). This page shows that capability→skill mapping (migration 0032) and how often each
// skill is actually used — NOT the raw skill library, which lives on /skills (the skill admin owns
// versions/commits/revision history; duplicating it here was redundant). Server Component: reads
// Aurora server-side (no secret/DB handle reaches the client). P6 (WCAG 2.2 AA): one <main>
// landmark, sections are cards (global CSS), data lives in captioned semantic tables.

import { listSkillUsage } from '@/app/lib/db/skillUsage.ts';
import { listCapabilitySkills } from '@/app/lib/db/capabilitySkills.ts';
import { PageHeader } from '@/app/components/PageHeader.ts';
import { EMPTY, relativeTime, formatTimestamp } from '@/app/lib/displayFormat.ts';
import { typeLabel } from '@/app/lib/artifactTypes.ts';

export const dynamic = 'force-dynamic';

export default async function CapabilitiesPage() {
  const [usage, capabilities] = await Promise.all([
    listSkillUsage(),
    listCapabilitySkills(),
  ]);
  const maxUses = usage.reduce((m, u) => Math.max(m, u.usage_count), 0);

  return (
    <main id="main">
      <PageHeader
        eyebrow="Skill library"
        title="Capabilities"
        description="What the engine can produce, which skills ground each capability, and how those skills are used."
      />

      <section aria-labelledby="mapping-heading">
        <h2 id="mapping-heading">Capability → skill mapping</h2>
        <p>
          {capabilities.length === 0
            ? 'No capability mapping is seeded yet — run the reference seeder (it loads the ' +
              'code-default mapping) and each artifact type and the skills that ground it appear here.'
            : 'Which skills ground each capability (artifact type) the engine can produce. The ' +
              'worker resolves this exact mapping at generation time — an operator override wins per ' +
              'capability, otherwise the seeded code default applies. The skills themselves (versions, ' +
              'commits, and revision history) live in the '}
          {capabilities.length === 0 ? null : <a href="/skills">skill library</a>}
          {capabilities.length === 0 ? null : '.'}
        </p>
        {capabilities.length > 0 ? (
          <table>
            <caption>
              Each capability (artifact type) and the skills that ground its generation.
            </caption>
            <thead>
              <tr>
                <th scope="col">Capability</th>
                <th scope="col">Grounding skills</th>
                <th scope="col">Source</th>
              </tr>
            </thead>
            <tbody>
              {capabilities.map((cap) => (
                <tr key={cap.artifact_type} data-capability={cap.artifact_type}>
                  <th scope="row">{typeLabel(cap.artifact_type)}</th>
                  <td>
                    <ul data-skill-list>
                      {cap.skills.map((skill) => (
                        <li key={skill.skill_name}>
                          <a href={`/skills#${encodeURIComponent(skill.skill_name)}`}>
                            {skill.skill_name}
                          </a>
                          {skill.required ? null : <span data-optional> (optional)</span>}
                        </li>
                      ))}
                    </ul>
                  </td>
                  <td>
                    {cap.skills.some((s) => s.source === 'operator-override')
                      ? 'Operator override'
                      : 'Code default'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </section>

      <section aria-labelledby="usage-heading">
        <h2 id="usage-heading">Skill usage</h2>
        <p>
          How often each skill has actually shaped generated content — one usage per artifact it
          helped produce, recorded by the worker with its graph/node provenance. The audit trail
          tying each launch's content back to the skill revision lives in the{' '}
          <a href="/skills">skill admin</a>.
        </p>
        {usage.length === 0 ? (
          <p data-empty="usage">
            No skill usage recorded yet — run a launch through content generation (or load the
            sample release) and the skills it invokes will appear here.
          </p>
        ) : (
          <table>
            <caption>Skill usage across all launches (most-used first).</caption>
            <thead>
              <tr>
                <th scope="col">Skill</th>
                <th scope="col">Uses</th>
                <th scope="col">Launches</th>
                <th scope="col">Sites</th>
                <th scope="col">Last used</th>
              </tr>
            </thead>
            <tbody>
              {usage.map((u) => (
                <tr key={u.skill_name} data-skill-usage={u.skill_name}>
                  <th scope="row">{u.skill_name}</th>
                  <td>
                    <span data-bar-cell>
                      {maxUses > 0 ? (
                        <span
                          data-bar-fill
                          aria-hidden
                          style={{ width: `${((u.usage_count / maxUses) * 100).toFixed(1)}%` }}
                        />
                      ) : null}
                      <span data-bar-value data-metric-value>
                        {u.usage_count.toLocaleString('en-US')}
                      </span>
                    </span>
                  </td>
                  <td data-metric-value>{u.run_count}</td>
                  <td data-metric-value>{u.node_count}</td>
                  <td>
                    {u.last_used === null ? (
                      EMPTY
                    ) : (
                      <time dateTime={u.last_used} title={formatTimestamp(u.last_used)}>
                        {relativeTime(u.last_used)}
                      </time>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
