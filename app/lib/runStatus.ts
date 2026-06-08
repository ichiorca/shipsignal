// T1 (spec 015) — release-run status state machine, shared by the dashboard, the API
// routes, and (mirrored in Python) the LangGraph worker.
// P1 (Substrate): LangGraph owns the run's control flow; this module just encodes the
// legal status lattice so every surface agrees on what a transition means.
//
// Supersedes the spec-001 4-state skeleton (queued/running/completed/failed): the run
// now models the full PRD §13.2 lifecycle. The DB column, the worker (`status.py`), and
// these constants advance through the same lattice so no surface ever shows an
// out-of-lattice status.

/** The full PRD §13.2 release lifecycle, in canonical progress order (happy path first,
 *  then the two off-path terminals). The worker advances a run forward through the
 *  progress states; `failed`/`cancelled` are reachable from any non-terminal state. */
export const RUN_STATUSES = [
  'created',
  'collecting_evidence',
  'evidence_ready',
  'features_pending_review',
  'features_approved',
  'generating_artifacts',
  'artifacts_pending_review',
  'artifacts_approved',
  'generating_media',
  'completed',
  'failed',
  'cancelled',
] as const;

export type RunStatus = (typeof RUN_STATUSES)[number];

/** The happy-path progress states in order. `failed`/`cancelled` are deliberately
 *  excluded — they are off-path terminals, not points on the linear lifecycle. */
const PROGRESS_ORDER: readonly RunStatus[] = [
  'created',
  'collecting_evidence',
  'evidence_ready',
  'features_pending_review',
  'features_approved',
  'generating_artifacts',
  'artifacts_pending_review',
  'artifacts_approved',
  'generating_media',
  'completed',
];

/** Every non-terminal state may fail or be cancelled out-of-band; appended to each
 *  forward edge below so the lattice need only spell out the happy-path successors. */
const OFF_RAMP: readonly RunStatus[] = ['failed', 'cancelled'];

/** Legal forward transitions. A run is inserted `created` (by the API/webhook); the
 *  worker advances it one step at a time as each graph progresses. `artifacts_approved`
 *  may go straight to `completed` when a run generates no demo media. */
const FORWARD: Readonly<Record<RunStatus, readonly RunStatus[]>> = {
  created: ['collecting_evidence'],
  collecting_evidence: ['evidence_ready'],
  evidence_ready: ['features_pending_review'],
  features_pending_review: ['features_approved'],
  features_approved: ['generating_artifacts'],
  generating_artifacts: ['artifacts_pending_review'],
  artifacts_pending_review: ['artifacts_approved'],
  artifacts_approved: ['generating_media', 'completed'],
  generating_media: ['completed'],
  completed: [],
  failed: [],
  cancelled: [],
};

function successors(status: RunStatus): readonly RunStatus[] {
  // A terminal state has no successors at all (not even an off-ramp).
  if (FORWARD[status].length === 0 && (status === 'completed' || isOffPathTerminal(status))) {
    return [];
  }
  return [...FORWARD[status], ...OFF_RAMP];
}

function isOffPathTerminal(status: RunStatus): boolean {
  return status === 'failed' || status === 'cancelled';
}

export function isRunStatus(value: unknown): value is RunStatus {
  return typeof value === 'string' && (RUN_STATUSES as readonly string[]).includes(value);
}

/** Position of a state on the linear progress path, or `null` for the off-path
 *  terminals (`failed`/`cancelled`). Used to make worker advancement idempotent under
 *  re-dispatch (advancing to an already-passed state is a no-op, not an error). */
export function progressIndex(status: RunStatus): number | null {
  const idx = PROGRESS_ORDER.indexOf(status);
  return idx === -1 ? null : idx;
}

export function isTerminal(status: RunStatus): boolean {
  return status === 'completed' || isOffPathTerminal(status);
}

/** True iff `next` is a legal successor of `current`. */
export function canTransition(current: RunStatus, next: RunStatus): boolean {
  return successors(current).includes(next);
}

export class InvalidStatusTransitionError extends Error {
  readonly from: RunStatus;
  readonly to: RunStatus;
  constructor(from: RunStatus, to: RunStatus) {
    super(`illegal run-status transition: ${from} -> ${to}`);
    this.name = 'InvalidStatusTransitionError';
    this.from = from;
    this.to = to;
  }
}

/** Assert a transition is legal, throwing `InvalidStatusTransitionError` otherwise.
 * Returns `to` so callers can write `status = assertTransition(status, 'evidence_ready')`. */
export function assertTransition(current: RunStatus, next: RunStatus): RunStatus {
  if (!canTransition(current, next)) {
    throw new InvalidStatusTransitionError(current, next);
  }
  return next;
}
