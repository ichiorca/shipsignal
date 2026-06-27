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
  | 'media_trigger'
  // operator feedback 2026-06-09 — records the reviewer who published an approved artifact
  // to a real destination (GitHub Release / Slack). Same rationale as media_trigger: not a
  // gate, but every outward-facing action names an accountable human.
  | 'artifact_publish'
  // records the reviewer who published a rendered demo VIDEO to an external platform
  // (e.g. YouTube). Outward-facing action → accountable human, same audit table.
  | 'media_publish';

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

/**
 * Idempotency-guarded variant for the one-shot dispatch routes (manifest resume, per-candidate
 * skill decision, media trigger, artifact publish). Each such action fires a non-idempotent
 * side effect, so a double-click / retry must NOT record a second audit row or re-dispatch.
 *
 * `dedupeKey` is enforced by the partial unique index `ux_approvals_dedupe` (migration 0024).
 * On the FIRST call the row is inserted and its id returned. On a replay (a row with the same
 * key already exists) the insert is a no-op and `null` is returned — the caller treats `null`
 * as "already actioned" and returns 200 WITHOUT re-dispatching.
 *
 * Note: the dedupe row marks a *completed* dispatch. If the outward dispatch then fails, the
 * caller must `deleteApproval(id)` to clear the marker so a retry can proceed (see the routes).
 */
export async function recordApprovalIdempotent(
  args: RecordApprovalArgs,
  dedupeKey: string,
  db: Queryable = { query },
): Promise<string | null> {
  const result = await db.query<{ id: string }>(
    `INSERT INTO approvals
       (target_type, target_id, decision, reviewer, notes, edited_payload_json, dedupe_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
     RETURNING id`,
    [
      args.target_type,
      args.target_id,
      args.decision,
      args.reviewer,
      args.notes ?? null,
      args.edited_payload ? JSON.stringify(args.edited_payload) : null,
      dedupeKey,
    ],
  );
  return result.rows[0]?.id ?? null;
}

/** Best-effort removal of an approvals row by id. Used to roll back a dedupe marker when the
 *  one-shot dispatch it guarded fails, so a subsequent retry is not blocked as a replay. */
export async function deleteApproval(id: string, db: Queryable = { query }): Promise<void> {
  await db.query('DELETE FROM approvals WHERE id = $1', [id]);
}

/** Outcome of acquiring a two-phase dispatch marker (see {@link beginApprovalDispatch}). */
export type DispatchAcquire =
  /** We won the insert and hold a 'pending' marker — proceed to dispatch, then complete it. */
  | { readonly kind: 'acquired'; readonly id: string }
  /** A prior dispatch for this key already completed — a genuine idempotent replay (claim success). */
  | { readonly kind: 'completed' }
  /** A concurrent dispatch holds a 'pending' marker — do NOT claim success; tell the caller to retry. */
  | { readonly kind: 'in_flight' };

/**
 * Phase 1 of a two-phase idempotent dispatch (fixes the marker-before-dispatch false-success race):
 * insert the dedupe marker as 'pending' BEFORE the outward call. Unlike
 * {@link recordApprovalIdempotent}, a conflict here is resolved by reading the existing marker's
 * state so a concurrent caller can be answered correctly:
 *   - we won the insert         → 'acquired' (proceed to dispatch, then {@link completeApprovalDispatch});
 *   - existing marker completed  → 'completed' (the prior send finished; safe idempotent success);
 *   - existing marker pending    → 'in_flight' (a send is mid-flight; the caller must NOT report
 *                                  published, only "retry shortly").
 * A legacy NULL ``dedupe_state`` (rows written before this column, or by the one-phase path) is
 * treated as 'completed' for backward compatibility.
 */
export async function beginApprovalDispatch(
  args: RecordApprovalArgs,
  dedupeKey: string,
  db: Queryable = { query },
): Promise<DispatchAcquire> {
  const inserted = await db.query<{ id: string }>(
    `INSERT INTO approvals
       (target_type, target_id, decision, reviewer, notes, edited_payload_json, dedupe_key, dedupe_state)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
     ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
     RETURNING id`,
    [
      args.target_type,
      args.target_id,
      args.decision,
      args.reviewer,
      args.notes ?? null,
      args.edited_payload ? JSON.stringify(args.edited_payload) : null,
      dedupeKey,
    ],
  );
  const wonId = inserted.rows[0]?.id;
  if (wonId !== undefined) {
    return { kind: 'acquired', id: wonId };
  }
  // Lost the insert race (or replay): inspect the existing marker's phase.
  const existing = await db.query<{ dedupe_state: string | null }>(
    `SELECT dedupe_state FROM approvals WHERE dedupe_key = $1`,
    [dedupeKey],
  );
  const state = existing.rows[0]?.dedupe_state ?? 'completed'; // legacy NULL ⇒ completed
  return state === 'pending' ? { kind: 'in_flight' } : { kind: 'completed' };
}

/** Phase 2: mark a previously-acquired dispatch marker 'completed' after the outward call
 *  succeeds, so a later replay resolves to an idempotent success rather than 'in_flight'. */
export async function completeApprovalDispatch(
  id: string,
  db: Queryable = { query },
): Promise<void> {
  await db.query(`UPDATE approvals SET dedupe_state = 'completed' WHERE id = $1`, [id]);
}
