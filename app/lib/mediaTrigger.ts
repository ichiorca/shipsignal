// T1 (spec 014) — input contract for POST /api/features/{featureId}/generate-demo (PRD §14.5).
// P5 (Safety rails) + constitution §5: the request body is untrusted; validate at the boundary
// with zod before anything touches Aurora or dispatches the worker. A reviewer identity is
// required so the trigger is recorded against an accountable human (audit trail), mirroring the
// Gate-decision contracts in featureReview.ts.

import { z } from 'zod';

// A human reviewer identifier (login/email). Bounded + trimmed; reject empties so a media
// trigger can never be recorded without an accountable reviewer.
const reviewer = z.string().trim().min(1).max(254);
const notes = z.string().trim().max(4000).optional();

/** POST /api/features/{featureId}/generate-demo — who triggered the demo render (+ optional note). */
export const generateDemoSchema = z
  .object({
    reviewer,
    notes,
  })
  .strict();

export type GenerateDemoInput = z.infer<typeof generateDemoSchema>;
