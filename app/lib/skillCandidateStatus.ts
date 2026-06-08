// T2 (spec 015) — skill-candidate status model (PRD §13.3), shared by the skills read
// APIs and the skill-admin / Gate #3 review surfaces so every surface agrees on what a
// candidate's lifecycle state means.
// P5 (Safety rails) + constitution §5/§9.4: a candidate is a *proposal* in Aurora — it
// only reaches `promoted` after a human Gate #3 approval drives the single repo SKILL.md
// write; `rejected`/`suppressed_duplicate` record the cooldown path (§9.4.6-7). The DB is
// the source of truth, so the guard exists to reject an out-of-lattice value loudly
// (mirrors the release-run guard in runStatus.ts).

/** The full PRD §13.3 skill-candidate lifecycle. `draft` is the staged proposal; a human
 *  decision moves it to `approved`→`promoted` (repo write succeeded), `rejected`, or
 *  `failed` (a promotion attempt errored); `suppressed_duplicate` is a near-duplicate
 *  re-mine held back for the §9.4.7 cooldown. */
export const SKILL_CANDIDATE_STATUSES = [
  'draft',
  'pending_review',
  'approved',
  'rejected',
  'promoted',
  'failed',
  'suppressed_duplicate',
] as const;

export type SkillCandidateStatus = (typeof SKILL_CANDIDATE_STATUSES)[number];

/** The terminal states — a candidate in one of these is resolved and never advances. */
const TERMINAL: ReadonlySet<SkillCandidateStatus> = new Set([
  'promoted',
  'rejected',
  'suppressed_duplicate',
]);

/** Legal forward transitions (§9.3 lifecycle). `approved` may reach `promoted` (the repo
 *  write succeeded) or fall back to `failed` if the write errored. */
const TRANSITIONS: Readonly<Record<SkillCandidateStatus, readonly SkillCandidateStatus[]>> = {
  draft: ['pending_review', 'approved', 'rejected', 'suppressed_duplicate'],
  pending_review: ['approved', 'rejected'],
  approved: ['promoted', 'failed'],
  failed: ['approved', 'rejected'],
  rejected: [],
  promoted: [],
  suppressed_duplicate: [],
};

/** True iff `value` is one of the seven PRD §13.3 statuses. The shared guard the read
 *  APIs and UI use to reject an unexpected DB value rather than render a bogus state. */
export function isSkillCandidateStatus(value: unknown): value is SkillCandidateStatus {
  return (
    typeof value === 'string' &&
    (SKILL_CANDIDATE_STATUSES as readonly string[]).includes(value)
  );
}

export function isSkillCandidateTerminal(status: SkillCandidateStatus): boolean {
  return TERMINAL.has(status);
}

/** True iff `next` is a legal successor of `current`. */
export function canTransitionSkillCandidate(
  current: SkillCandidateStatus,
  next: SkillCandidateStatus,
): boolean {
  return TRANSITIONS[current].includes(next);
}

export class InvalidSkillCandidateTransitionError extends Error {
  readonly from: SkillCandidateStatus;
  readonly to: SkillCandidateStatus;
  constructor(from: SkillCandidateStatus, to: SkillCandidateStatus) {
    super(`illegal skill-candidate status transition: ${from} -> ${to}`);
    this.name = 'InvalidSkillCandidateTransitionError';
    this.from = from;
    this.to = to;
  }
}

/** Assert a transition is legal, throwing otherwise. Returns `to` for chaining. */
export function assertSkillCandidateTransition(
  current: SkillCandidateStatus,
  next: SkillCandidateStatus,
): SkillCandidateStatus {
  if (!canTransitionSkillCandidate(current, next)) {
    throw new InvalidSkillCandidateTransitionError(current, next);
  }
  return next;
}

/** Narrow a raw DB value to a `SkillCandidateStatus`, throwing on schema drift. Use at
 *  the Aurora read boundary so the UI never receives an out-of-lattice status. */
export function parseSkillCandidateStatus(value: unknown): SkillCandidateStatus {
  if (!isSkillCandidateStatus(value)) {
    throw new Error(`unexpected skill-candidate status in DB: ${String(value)}`);
  }
  return value;
}
