// Per-candidate Gate #3 handler (PRD §14.4) — shared by
// POST /api/skills/candidates/{candidateId}/approve and /reject.
//
// These are thin aliases over the run-level resume-skill flow: the decision is fixed by the
// route, the body carries only reviewer + optional notes. We resolve the candidate's owning
// release run (via its supporting learning_signals) and derive the SAME deterministic
// skill_learning thread id the worker uses (worker loop_orchestration.thread_id_for =
// `lg_<run>_skill_learning`), record the per-candidate decision in the immutable approvals
// audit log, then resume that thread past the approve_skill_candidate interrupt. The repo
// SKILL.md is replaced by the WORKER on the runner (the single repo write), never here
// (constitution §1); reviewer identity is required (no anonymous self-approval).

import 'server-only';
import { z } from 'zod';

import { skillCandidateDecisionSchema, parseBody } from '@/app/lib/skillReview.ts';
import { getCandidateResumeTarget } from '@/app/lib/db/skillCandidates.ts';
import { recordApproval } from '@/app/lib/db/approvals.ts';
import { dispatchResume } from '@/app/lib/resumeDispatch.ts';

const candidateIdSchema = z.string().uuid();

export interface GateOutcome {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

/** Decide a single skill candidate (approve|reject) and resume its run's skill_learning thread.
 *  Returns the HTTP status + JSON body for the calling route. Never writes repo files. */
export async function decideSkillCandidate(
  candidateId: string,
  decision: 'approved' | 'rejected',
  rawBody: unknown,
): Promise<GateOutcome> {
  if (!candidateIdSchema.safeParse(candidateId).success) {
    return { status: 400, body: { error: 'candidateId must be a uuid' } };
  }

  const parsed = parseBody(skillCandidateDecisionSchema, rawBody);
  if (!parsed.ok) {
    return { status: 400, body: { error: 'invalid decision input', details: parsed.errors } };
  }

  const target = await getCandidateResumeTarget(candidateId);
  if (target === null) {
    return { status: 404, body: { error: 'skill candidate not found' } };
  }
  if (target.releaseRunId === null) {
    return {
      status: 409,
      body: { error: 'candidate has no associated release run to resume' },
    };
  }

  // Record the per-candidate decision (immutable audit trail) BEFORE resuming, then resume the
  // run's skill_learning thread. The worker performs the promotion (approved) or
  // rejection+cooldown (rejected) and the single repo write.
  await recordApproval({
    target_type: 'skill_candidate',
    target_id: candidateId,
    decision,
    reviewer: parsed.value.reviewer,
    notes: parsed.value.notes,
  });

  const threadId = `lg_${target.releaseRunId}_skill_learning`;
  try {
    await dispatchResume({
      releaseRunId: target.releaseRunId,
      threadId,
      decision,
      graph: 'skill_learning',
      reviewer: parsed.value.reviewer,
    });
  } catch (err) {
    console.error('gate#3 per-candidate resume dispatch failed', {
      candidateId,
      message: String(err),
    });
    return {
      status: 502,
      body: { warning: 'decision recorded but resume dispatch failed; retry' },
    };
  }

  return {
    status: 200,
    body: {
      candidate_id: candidateId,
      release_run_id: target.releaseRunId,
      decision,
      resumed: true,
    },
  };
}
