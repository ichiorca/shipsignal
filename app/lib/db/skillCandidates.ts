// T5 (spec 009) — skill_revision_candidates repository: typed reads for the Gate #3
// proposed-skill review screen (PRD §9.5, §10.5). P5 (Safety rails) + constitution §5/§9.2:
// Aurora is the staging ledger — a candidate is a *proposal* (status='draft') until a human
// approves it; the canonical skill stays the repo SKILL.md, replaced only by the worker on an
// approved resume. The screen shows the current vs proposed body, the supporting signals, the
// confidence and source — never a secret or raw evidence (the bodies are repo-authored skill
// text; the signal excerpts derive from redacted/internal review data). All queries are
// parameterised and a run's candidates are scoped through their supporting learning_signals.

import { query } from '@/app/lib/aurora.ts';

/** One supporting learning signal shown in the Gate #3 "supporting evidence" panel (PRD §9.5). */
export interface SupportingSignalView {
  readonly id: string;
  readonly signal_type: string; // 'reviewer_edit' | 'rejected_claim' | 'review_note'
  readonly rejection_category: string | null;
  readonly severity: string | null;
  readonly reviewer: string | null;
  readonly excerpt: string;
}

/** A staged skill-revision candidate as the Gate #3 diff screen renders it. `current_body` is the
 *  recorded body excerpt of the base snapshot (left panel); `proposed_body` is the candidate (right
 *  panel). `status` is 'draft' for a pending candidate. */
export interface SkillCandidateView {
  readonly id: string;
  readonly skill_name: string;
  readonly skill_path: string;
  readonly current_version: string | null;
  readonly proposed_version: string;
  readonly current_body: string;
  readonly proposed_body: string;
  readonly proposal_reason: string;
  readonly miner_type: string;
  readonly confidence: number | null;
  readonly status: string;
  readonly supporting_signals: readonly SupportingSignalView[];
}

interface CandidateRow {
  id: string;
  skill_name: string;
  skill_path: string;
  current_version: string | null;
  proposed_version: string;
  current_body: string | null;
  proposed_body: string;
  proposal_reason: string;
  miner_type: string;
  confidence: string | number | null;
  status: string;
  supporting_signal_ids: unknown;
}

interface SignalRow {
  id: string;
  signal_type: string;
  rejection_category: string | null;
  severity: string | null;
  reviewer: string | null;
  source_text: string | null;
}

const EXCERPT_CHARS = 280;

function asNum(value: string | number | null): number | null {
  return value === null ? null : Number(value);
}

function asIdList(value: unknown): string[] {
  // pg returns a uuid[] as a JS array; keep only string ids (defensive: data at rest).
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string');
}

// The base snapshot supplies the "current" version + body excerpt for the left diff panel; LEFT
// JOIN so a candidate whose base snapshot was erased still renders (with an empty current body).
const CANDIDATE_COLUMNS = `
  c.id, c.skill_name, c.skill_path,
  s.skill_version AS current_version, c.proposed_version,
  s.body_excerpt  AS current_body, c.proposed_body,
  c.proposal_reason, c.miner_type, c.confidence, c.status, c.supporting_signal_ids`;

async function loadSignals(ids: readonly string[]): Promise<SupportingSignalView[]> {
  if (ids.length === 0) return [];
  const result = await query<SignalRow>(
    `SELECT id, signal_type, rejection_category, severity, reviewer, source_text
       FROM learning_signals
      WHERE id = ANY($1)
      ORDER BY created_at ASC`,
    [ids],
  );
  return result.rows.map((r) => ({
    id: r.id,
    signal_type: r.signal_type,
    rejection_category: r.rejection_category,
    severity: r.severity,
    reviewer: r.reviewer,
    excerpt: (r.source_text ?? '').slice(0, EXCERPT_CHARS),
  }));
}

function mapCandidate(
  row: CandidateRow,
  signals: readonly SupportingSignalView[],
): SkillCandidateView {
  return {
    id: row.id,
    skill_name: row.skill_name,
    skill_path: row.skill_path,
    current_version: row.current_version,
    proposed_version: row.proposed_version,
    current_body: row.current_body ?? '',
    proposed_body: row.proposed_body,
    proposal_reason: row.proposal_reason,
    miner_type: row.miner_type,
    confidence: asNum(row.confidence),
    status: row.status,
    supporting_signals: signals,
  };
}

/** List a run's PENDING (draft) skill-revision candidates, each with its current/proposed body and
 *  supporting signals, for the Gate #3 review screen. A candidate belongs to the run when any of
 *  its supporting signals was mined from that run (skills are repo-level, but the review is reached
 *  from the run that produced the learning). */
export async function listSkillCandidatesForRun(
  releaseRunId: string,
  limit = 50,
): Promise<readonly SkillCandidateView[]> {
  const result = await query<CandidateRow>(
    `SELECT ${CANDIDATE_COLUMNS}
       FROM skill_revision_candidates c
       LEFT JOIN skill_repo_snapshots s ON s.id = c.base_skill_snapshot_id
      WHERE c.status = 'draft'
        AND EXISTS (
              SELECT 1 FROM learning_signals ls
               WHERE ls.release_run_id = $1
                 AND ls.id = ANY(c.supporting_signal_ids)
            )
      ORDER BY c.created_at DESC
      LIMIT $2`,
    [releaseRunId, limit],
  );

  const candidates: SkillCandidateView[] = [];
  for (const row of result.rows) {
    const signals = await loadSignals(asIdList(row.supporting_signal_ids));
    candidates.push(mapCandidate(row, signals));
  }
  return candidates;
}
