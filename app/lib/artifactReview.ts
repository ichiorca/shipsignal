// T5 (spec 006) — input contracts for the Gate #2 artifact-review actions (PRD §14.3).
// P5 (Safety rails): every inbound request body for approve/reject/edit/resume is untrusted;
// validate at the boundary with zod before anything touches Aurora or dispatches a resume.
// Reviewer identity is required on every decision (constitution §5 audit trail / no anonymous
// self-approval). Reuses the shared ParseResult/parseBody helper from featureReview.

import { z } from 'zod';
import { parseBody } from '@/app/lib/featureReview.ts';

export { parseBody };
export type { ParseResult } from '@/app/lib/featureReview.ts';

// A human reviewer identifier (login/email). Bounded + trimmed; reject empties so an
// approval can never be recorded without an accountable reviewer.
const reviewer = z.string().trim().min(1).max(254);
const notes = z.string().trim().max(4000).optional();

/** POST /api/artifacts/{artifactId}/approve and .../reject share this body. */
export const artifactDecisionSchema = z
  .object({
    reviewer,
    notes,
  })
  .strict();

export type ArtifactDecisionInput = z.infer<typeof artifactDecisionSchema>;

// The narrative fields a reviewer may edit (never the claims/support status — those are
// deterministic). At least one must be present so an "edit" actually changes something.
const artifactEditFields = z
  .object({
    title: z.string().trim().min(1).max(300).optional(),
    body_markdown: z.string().trim().min(1).max(40000).optional(),
  })
  .strict();

/** PATCH /api/artifacts/{artifactId} — an edit decision plus the edited fields. */
export const artifactEditSchema = z
  .object({
    reviewer,
    notes,
    edits: artifactEditFields.refine((e) => Object.keys(e).length > 0, {
      message: 'at least one field must be edited',
    }),
  })
  .strict();

export type ArtifactEditInput = z.infer<typeof artifactEditSchema>;

/** POST /api/releases/{releaseRunId}/resume-artifacts — submit the Gate #2 review and resume
 *  the content_generation worker thread past the approve_artifacts interrupt. `decision` is
 *  the run-level outcome; `thread_id` resumes the SAME LangGraph thread (PRD §5.6). */
export const artifactResumeSchema = z
  .object({
    reviewer,
    decision: z.enum(['approved', 'rejected', 'edited']),
    thread_id: z.string().trim().min(1).max(200),
    notes,
  })
  .strict();

export type ArtifactResumeInput = z.infer<typeof artifactResumeSchema>;
