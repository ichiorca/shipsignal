// T5 (spec 009) — skill_revision_candidates repository: typed reads for the Gate #3
// proposed-skill review screen (PRD §9.5, §10.5). P5 (Safety rails) + constitution §5/§9.2:
// Aurora is the staging ledger — a candidate is a *proposal* (status='draft') until a human
// approves it; the canonical skill stays the repo SKILL.md, replaced only by the worker on an
// approved resume. The screen shows the current vs proposed body, the supporting signals, the
// confidence and source — never a secret or raw evidence (the bodies are repo-authored skill
// text; the signal excerpts derive from redacted/internal review data). All queries are
// parameterised and a run's candidates are scoped through their supporting learning_signals.

import { query } from '@/app/lib/aurora.ts';
import { isUuid } from '@/app/lib/uuid.ts';
import {
  parseSkillCandidateStatus,
  type SkillCandidateStatus,
} from '@/app/lib/skillCandidateStatus.ts';

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
  readonly status: SkillCandidateStatus;
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
    // The DB is the source of truth; an out-of-lattice status means schema drift, which
    // we surface loudly rather than rendering a bogus state (P5 / constitution §9.3).
    status: parseSkillCandidateStatus(row.status),
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

// --- T4 (spec 015): the §14.4 skills read API (not run-scoped, any status) -------------

/** A lightweight candidate row for the admin list (no bodies/signals) — enough to show a
 *  candidate's skill, proposed version, source, confidence, and lifecycle status. */
export interface SkillCandidateSummary {
  readonly id: string;
  readonly skill_name: string;
  readonly skill_path: string;
  readonly proposed_version: string;
  readonly miner_type: string;
  readonly confidence: number | null;
  readonly status: SkillCandidateStatus;
  readonly created_at: string;
}

interface SummaryRow {
  id: string;
  skill_name: string;
  skill_path: string;
  proposed_version: string;
  miner_type: string;
  confidence: string | number | null;
  status: string;
  created_at: string | Date;
}

/** List skill-revision candidates across all runs and statuses (newest-first) for the
 *  skill-admin surface (PRD §14.4 `GET /api/skills/candidates`). Lightweight: no bodies
 *  or signals — `getSkillCandidate` loads those for one candidate. */
export async function listSkillCandidates(
  limit = 100,
): Promise<readonly SkillCandidateSummary[]> {
  const result = await query<SummaryRow>(
    `SELECT id, skill_name, skill_path, proposed_version, miner_type, confidence,
            status, created_at
       FROM skill_revision_candidates
      ORDER BY created_at DESC
      LIMIT $1`,
    [limit],
  );
  return result.rows.map((row) => ({
    id: row.id,
    skill_name: row.skill_name,
    skill_path: row.skill_path,
    proposed_version: row.proposed_version,
    miner_type: row.miner_type,
    confidence: asNum(row.confidence),
    status: parseSkillCandidateStatus(row.status),
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  }));
}

/** Fetch one skill-revision candidate by id — with its current/proposed body and
 *  supporting signals — or null if it does not exist (PRD §14.4
 *  `GET /api/skills/candidates/{candidateId}`). Any status (not just draft). */
export async function getSkillCandidate(
  candidateId: string,
): Promise<SkillCandidateView | null> {
  if (!isUuid(candidateId)) return null;
  const result = await query<CandidateRow>(
    `SELECT ${CANDIDATE_COLUMNS}
       FROM skill_revision_candidates c
       LEFT JOIN skill_repo_snapshots s ON s.id = c.base_skill_snapshot_id
      WHERE c.id = $1`,
    [candidateId],
  );
  const row = result.rows[0];
  if (row === undefined) return null;
  const signals = await loadSignals(asIdList(row.supporting_signal_ids));
  return mapCandidate(row, signals);
}

/** Resolve a candidate's owning release run + current status for the per-candidate Gate #3
 *  routes (§14.4). `skill_revision_candidates` has no release_run_id column — a candidate is
 *  scoped to a run only THROUGH its supporting learning_signals — so we recover the run from
 *  any supporting signal that carries one. Returns null when the candidate id is unknown;
 *  `releaseRunId` is null when no supporting signal carries a run (cannot resume a thread). */
export async function getCandidateResumeTarget(
  candidateId: string,
): Promise<{ readonly status: SkillCandidateStatus; readonly releaseRunId: string | null } | null> {
  const result = await query<{ status: string; release_run_id: string | null }>(
    `SELECT c.status AS status,
            (SELECT ls.release_run_id::text
               FROM learning_signals ls
              WHERE ls.id = ANY(c.supporting_signal_ids)
                AND ls.release_run_id IS NOT NULL
              LIMIT 1) AS release_run_id
       FROM skill_revision_candidates c
      WHERE c.id = $1`,
    [candidateId],
  );
  const row = result.rows[0];
  if (row === undefined) return null;
  return { status: parseSkillCandidateStatus(row.status), releaseRunId: row.release_run_id };
}
