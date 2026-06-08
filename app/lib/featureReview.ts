// T5/T6 (spec 004) — input contracts for the Gate #1 review actions.
// P5 (Safety rails): every inbound request body for approve/reject/edit/resume is
// untrusted; validate at the boundary with zod before anything touches Aurora or
// dispatches a resume. Reviewer identity is required on every decision (constitution §5
// audit trail / no anonymous self-approval).

import { z } from 'zod';

// A human reviewer identifier (login/email). Bounded + trimmed; reject empties so an
// approval can never be recorded without an accountable reviewer.
const reviewer = z.string().trim().min(1).max(254);
const notes = z.string().trim().max(4000).optional();

/** POST /api/features/{featureId}/approve and .../reject share this body. */
export const decisionSchema = z
  .object({
    reviewer,
    notes,
  })
  .strict();

export type DecisionInput = z.infer<typeof decisionSchema>;

// The narrative fields a reviewer may edit (never the deterministic scores). All
// optional; at least one must be present so an "edit" actually changes something.
const editFields = z
  .object({
    title: z.string().trim().min(1).max(300).optional(),
    summary_internal: z.string().trim().max(4000).optional(),
    user_value: z.string().trim().max(4000).optional(),
    audiences: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
    change_type: z.string().trim().min(1).max(80).optional(),
    surface_area: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
  })
  .strict();

/** PATCH /api/features/{featureId} — an edit decision plus the edited fields. */
export const editSchema = z
  .object({
    reviewer,
    notes,
    edits: editFields.refine((e) => Object.keys(e).length > 0, {
      message: 'at least one field must be edited',
    }),
  })
  .strict();

export type EditInput = z.infer<typeof editSchema>;

/** POST /api/releases/{releaseRunId}/resume — submit the manifest review and resume the
 *  worker thread past Gate #1. `decision` is the run-level outcome (approved proceeds to
 *  content generation). `thread_id` resumes the SAME LangGraph thread (PRD §5.6). */
export const resumeSchema = z
  .object({
    reviewer,
    decision: z.enum(['approved', 'rejected', 'edited']),
    thread_id: z.string().trim().min(1).max(200),
    notes,
  })
  .strict();

export type ResumeInput = z.infer<typeof resumeSchema>;

export type ParseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly string[] };

function flatten(error: z.ZodError): readonly string[] {
  return error.issues.map((issue) =>
    issue.path.length > 0 ? `${issue.path.join('.')}: ${issue.message}` : issue.message,
  );
}

/** Validate an untrusted, already-JSON-parsed body against `schema`. Never throws. */
export function parseBody<T>(schema: z.ZodType<T>, body: unknown): ParseResult<T> {
  const result = schema.safeParse(body);
  return result.success
    ? { ok: true, value: result.data }
    : { ok: false, errors: flatten(result.error) };
}
