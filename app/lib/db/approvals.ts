// T5/T6 (spec 004) — approvals repository: the gate decision log (PRD §10.4).
// P5 (Safety rails) + constitution §5: every Gate #1 action (approve/edit/reject) is
// recorded here with the reviewer + decision, so there is an immutable audit trail and
// no decision is silently applied. `edited_payload_json` captures the reviewer's edits.
// Gate-agnostic (target_type/target_id) so Gate #2/#3 reuse it later. All queries
// parameterised.

import { query, type Queryable } from '@/app/lib/aurora.ts';

export type ApprovalDecision = 'approved' | 'rejected' | 'edited';

/** What the gate is deciding on. Gate #1 uses 'feature' per-card and 'feature_manifest'
 *  for the run-level resume submission; Gate #2 (spec 006) uses 'artifact' per-artifact and
 *  'artifact_manifest' for the run-level resume; Gate #3 (spec 009) uses 'skill_candidate'
 *  per-candidate and 'skill_candidate_manifest' for the run-level skill-replacement resume.
 *  The table is gate-agnostic (§10.4). */
export type ApprovalTargetType =
  | 'feature'
  | 'feature_manifest'
  | 'artifact'
  | 'artifact_manifest'
  | 'skill_candidate'
  | 'skill_candidate_manifest'
  // spec 014 T1 — records the reviewer who triggered demo-media generation for a feature
  // (PRD §14.5). Not a gate decision, but logged in the same gate-agnostic audit table
  // (§10.4, free-text target_type) so the trigger names an accountable human.
  | 'media_trigger';

export interface RecordApprovalArgs {
  readonly target_type: ApprovalTargetType;
  readonly target_id: string;
  readonly decision: ApprovalDecision;
  readonly reviewer: string;
  // `| undefined` so callers can forward an optional zod field (exactOptionalPropertyTypes).
  readonly notes?: string | undefined;
  /** Present only on an edit decision: the reviewer's edited payload. */
  readonly edited_payload?: Readonly<Record<string, unknown>> | undefined;
}

/** Insert one approvals row. Returns the generated id for the caller's audit/log. */
export async function recordApproval(
  args: RecordApprovalArgs,
  db: Queryable = { query },
): Promise<string> {
  const result = await db.query<{ id: string }>(
    `INSERT INTO approvals
       (target_type, target_id, decision, reviewer, notes, edited_payload_json)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [
      args.target_type,
      args.target_id,
      args.decision,
      args.reviewer,
      args.notes ?? null,
      args.edited_payload ? JSON.stringify(args.edited_payload) : null,
    ],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error('insert approval returned no row');
  }
  return row.id;
}
