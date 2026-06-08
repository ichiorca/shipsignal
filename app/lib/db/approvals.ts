// T5/T6 (spec 004) — approvals repository: the gate decision log (PRD §10.4).
// P5 (Safety rails) + constitution §5: every Gate #1 action (approve/edit/reject) is
// recorded here with the reviewer + decision, so there is an immutable audit trail and
// no decision is silently applied. `edited_payload_json` captures the reviewer's edits.
// Gate-agnostic (target_type/target_id) so Gate #2/#3 reuse it later. All queries
// parameterised.

import { query } from '@/app/lib/aurora.ts';

export type ApprovalDecision = 'approved' | 'rejected' | 'edited';

/** What the gate is deciding on. Gate #1 uses 'feature' per-card and 'feature_manifest'
 *  for the run-level resume submission. */
export type ApprovalTargetType = 'feature' | 'feature_manifest';

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
export async function recordApproval(args: RecordApprovalArgs): Promise<string> {
  const result = await query<{ id: string }>(
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
