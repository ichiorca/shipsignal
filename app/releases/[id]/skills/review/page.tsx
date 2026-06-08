// T5 (spec 009) — Gate #3 proposed-skill review page (PRD §5.6, §9.5).
// Server Component: reads Aurora server-side (no secret or DB handle reaches the client) and
// renders each pending skill candidate with the interactive review island. P6 (WCAG 2.2 AA): one
// <main> landmark + heading; the diff + decision controls live in the labelled, keyboard-operable
// SkillCandidateReview. constitution §1/§5: only redacted/internal data is shown, the gate blocks
// the repo replacement until a human decision resumes the worker, and the UI never writes the repo
// file — the worker performs the single repo write on the runner.

import { notFound } from 'next/navigation';
import { getReleaseRun } from '@/app/lib/db/releaseRuns.ts';
import { listSkillCandidatesForRun } from '@/app/lib/db/skillCandidates.ts';
import { SkillCandidateReview } from '@/app/components/SkillCandidateReview.ts';

// Always reflect the latest candidate + decision state for the run.
export const dynamic = 'force-dynamic';

interface ReviewPageProps {
  readonly params: Promise<{ id: string }>;
}

export default async function SkillCandidateReviewPage({ params }: ReviewPageProps) {
  const { id } = await params;
  const run = await getReleaseRun(id);
  if (run === null) {
    notFound();
  }

  const candidates = await listSkillCandidatesForRun(run.id);

  return (
    <main id="main">
      <p>
        <a href={`/releases/${run.id}`}>← Back to release run</a>
      </p>
      <h1>Review skill revisions (Gate #3)</h1>
      <p>
        {run.repo} · {run.base_ref}…{run.head_ref}
      </p>
      <p>
        {candidates.length === 0
          ? 'No skill-revision candidates are pending review for this run.'
          : `${candidates.length} skill candidate${candidates.length === 1 ? '' : 's'} pending review.`}
      </p>
      <SkillCandidateReview
        releaseRunId={run.id}
        threadId={run.langgraph_thread_id}
        candidates={candidates}
      />
    </main>
  );
}
