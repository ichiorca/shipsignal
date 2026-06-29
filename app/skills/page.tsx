// T5 (spec 015) — Skill-admin screen (PRD §13.1): the active repo skills, their Aurora
// snapshot/candidate provenance, AND how often each skill has actually shaped generated content
// (skill usage moved here from /capabilities — usage belongs with the skill library, not the
// capability→skill mapping). Server Component: it reads Aurora server-side (no secret or DB handle
// reaches the client). P6 (WCAG 2.2 AA): one <main> landmark + headings; data lives in the
// semantic, keyboard-navigable SkillAdmin + a captioned usage table. constitution §9.2: Aurora is
// the provenance ledger — only snapshot metadata + staged candidate summaries are shown.

import { listSkills } from '@/app/lib/db/skills.ts';
import { listSkillCandidates } from '@/app/lib/db/skillCandidates.ts';
import { listSkillUsage } from '@/app/lib/db/skillUsage.ts';
import { PageHeader } from '@/app/components/PageHeader.ts';
import { SkillAdmin } from '@/app/components/SkillAdmin.ts';
import { EMPTY, relativeTime, formatTimestamp } from '@/app/lib/displayFormat.ts';

// Always reflect the latest snapshots + candidate states.
export const dynamic = 'force-dynamic';

export default async function SkillsPage() {
  const [skills, candidates, usage] = await Promise.all([
    listSkills(),
    listSkillCandidates(),
    listSkillUsage(),
  ]);
  const maxUses = usage.reduce((m, u) => Math.max(m, u.usage_count), 0);
  const count =
    `${skills.length === 1 ? '1 active skill' : `${skills.length} active skills`} · ` +
    `${candidates.length === 1 ? '1 revision candidate' : `${candidates.length} revision candidates`}`;

  return (
    <main id="main">
      <PageHeader
        eyebrow="Library"
        title="Skills"
        description={`Playbook versions — the active repo skills, the revisions the system proposes, and how each skill is used. ${count}.`}
      />
      <SkillAdmin skills={skills} candidates={candidates} />

      <section aria-labelledby="usage-heading">
        <h2 id="usage-heading">Skill usage</h2>
        <p>
          How often each skill has actually shaped generated content — one usage per artifact it
          helped produce, recorded by the worker with its graph/node provenance.
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
