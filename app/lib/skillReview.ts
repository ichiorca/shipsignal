// T5 (spec 009) — input contract for the Gate #3 skill-candidate review action (PRD §9.5, §14).
// P5 (Safety rails): the inbound resume body is untrusted; validate at the boundary with zod
// before anything touches Aurora or dispatches a worker resume. Reviewer identity is required on
// every decision (constitution §5 audit trail / no anonymous self-approval). The decision drives
// the worker branch: 'approved' → repo SKILL.md replaced (the single repo write) + promotion
// recorded; 'rejected' → rejection + cooldown suppression; 'edited' → request-changes (recorded,
// candidate stays open). Reuses the shared ParseResult/parseBody helper from featureReview.

import { z } from 'zod';
import { parseBody } from '@/app/lib/featureReview.ts';

export { parseBody };
export type { ParseResult } from '@/app/lib/featureReview.ts';

// A human reviewer identifier (login/email). Bounded + trimmed; reject empties so a skill
// replacement can never be recorded without an accountable reviewer (no self-approval).
const reviewer = z.string().trim().min(1).max(254);
const notes = z.string().trim().max(4000).optional();

/** POST /api/releases/{releaseRunId}/resume-skill — submit the Gate #3 review and resume the
 *  skill_learning worker thread past the approve_skill_candidate interrupt. `decision` is the
 *  run-level outcome. `thread_id` is accepted for backward-compat but IGNORED: the server
 *  derives the thread id from the path run id + graph (constitution §5). */
export const skillResumeSchema = z
  .object({
    reviewer,
    decision: z.enum(['approved', 'rejected', 'edited']),
    thread_id: z.string().trim().min(1).max(200).optional(),
    notes,
  })
  .strict();

export type SkillResumeInput = z.infer<typeof skillResumeSchema>;

/** POST /api/skills/candidates/{candidateId}/approve | /reject — the per-candidate Gate #3
 *  verbs the PRD names in §14.4. Thin aliases over the run-level resume: the decision is fixed
 *  by the route, so the body carries only the (required) reviewer + optional notes. The route
 *  resolves the candidate's release run + thread server-side and resumes the same skill_learning
 *  thread (PRD §5.6); the worker still performs the single repo write (no self-approval). */
export const skillCandidateDecisionSchema = z.object({ reviewer, notes }).strict();

export type SkillCandidateDecisionInput = z.infer<typeof skillCandidateDecisionSchema>;
