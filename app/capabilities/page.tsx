// Reskin (peer parity with hindsight-guild/web Capabilities.tsx) — the "Capabilities" view.
// ShipSignal's capabilities are the active repo skills that ground generation: each one is a
// versioned SKILL.md loaded from the repo, with its commit SHA and Aurora snapshot history as
// provenance. We present those as the system's capabilities. There is no `skill_usage_events`
// table in this app, so per-agent usage detail is surfaced honestly as "lives in each launch's
// skill ledger" with a link to /skills rather than invented usage metrics. Server Component:
// reads Aurora server-side (no secret/DB handle reaches the client). P6 (WCAG 2.2 AA): one <main>
// landmark, sections are cards (global CSS), data lives in a captioned semantic table.

import { listSkills } from '@/app/lib/db/skills.ts';
import { listSkillUsage } from '@/app/lib/db/skillUsage.ts';
import { PageHeader } from '@/app/components/PageHeader.ts';
import { EMPTY, relativeTime, formatTimestamp } from '@/app/lib/displayFormat.ts';

export const dynamic = 'force-dynamic';

export default async function CapabilitiesPage() {
  const [skills, usage] = await Promise.all([listSkills(), listSkillUsage()]);
  const maxUses = usage.reduce((m, u) => Math.max(m, u.usage_count), 0);

  return (
    <main id="main">
      <PageHeader
        eyebrow="Skill library"
        title="Capabilities"
        description="Which skills each agent has, and how they're used."
      />

      <section aria-labelledby="capabilities-heading">
        <h2 id="capabilities-heading">Active skills</h2>
        <p>
          {skills.length === 0
            ? 'No active skills are loaded yet.'
            : `${skills.length === 1 ? '1 skill' : `${skills.length} skills`} ground every draft. ` +
              'Each is a repo SKILL.md loaded at its recorded commit, with its full revision ' +
              'history staged in the Aurora provenance ledger.'}
        </p>
        {skills.length > 0 ? (
          <table>
            <caption>Active repo skills with version, commit, and recorded snapshot count.</caption>
            <thead>
              <tr>
                <th scope="col">Skill</th>
                <th scope="col">Repo path</th>
                <th scope="col">Version</th>
                <th scope="col">Active commit</th>
                <th scope="col">Snapshots</th>
              </tr>
            </thead>
            <tbody>
              {skills.map((skill) => (
                <tr key={`${skill.repo}:${skill.skill_path}`}>
                  <th scope="row">
                    <a href={`/skills#${encodeURIComponent(skill.skill_name)}`}>
                      {skill.skill_name}
                    </a>
                  </th>
                  <td>
                    <code>{skill.skill_path}</code>
                  </td>
                  <td>{skill.active_version ?? EMPTY}</td>
                  <td>
                    <code title={skill.active_commit_sha}>
                      {skill.active_commit_sha.slice(0, 12)}
                    </code>
                  </td>
                  <td>{skill.snapshot_count}</td>
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
