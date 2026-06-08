// T5 (spec 015) — Skill-admin screen (PRD §13.1): the active repo skills and their Aurora
// snapshot/candidate provenance. Server Component: it reads Aurora server-side (no secret
// or DB handle reaches the client) and renders the presentational SkillAdmin. P6 (WCAG 2.2
// AA): one <main> landmark + heading; the data lives in the semantic, keyboard-navigable
// SkillAdmin tables. constitution §9.2: Aurora is the provenance ledger — only snapshot
// metadata + staged candidate summaries are shown, never the repo write itself.

import { listSkills } from '@/app/lib/db/skills.ts';
import { listSkillCandidates } from '@/app/lib/db/skillCandidates.ts';
import { SkillAdmin } from '@/app/components/SkillAdmin.ts';

// Always reflect the latest snapshots + candidate states.
export const dynamic = 'force-dynamic';

export default async function SkillAdminPage() {
  const [skills, candidates] = await Promise.all([listSkills(), listSkillCandidates()]);

  return (
    <main id="main">
      <p>
        <a href="/">← All release runs</a>
      </p>
      <h1>Skill admin</h1>
      <p>
        {skills.length === 1 ? '1 active skill' : `${skills.length} active skills`} ·{' '}
        {candidates.length === 1
          ? '1 revision candidate'
          : `${candidates.length} revision candidates`}
      </p>
      <SkillAdmin skills={skills} candidates={candidates} />
    </main>
  );
}
