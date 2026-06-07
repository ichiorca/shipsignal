// T2/T5 (spec 001) — release-run status state machine, shared by the dashboard,
// the API routes, and (mirrored in Python) the LangGraph worker.
// P1 (Substrate): LangGraph owns the run's control flow; this module just encodes
// the legal status lattice so every surface agrees on what a transition means.
//
// PRD §13.2 defines the full release lifecycle. This skeleton spec only exercises
// the trigger→run→done arc, so we model that arc exactly and reject anything else
// rather than silently accepting an out-of-scope status.

/** The subset of PRD §13.2 statuses the skeleton run lifecycle uses. */
export const RUN_STATUSES = ['queued', 'running', 'completed', 'failed'] as const;

export type RunStatus = (typeof RUN_STATUSES)[number];

/** Legal forward transitions. A run starts `queued` (inserted by the API/webhook),
 * the worker moves it `running`, then to a terminal `completed`/`failed`. */
const TRANSITIONS: Readonly<Record<RunStatus, readonly RunStatus[]>> = {
  queued: ['running', 'failed'],
  running: ['completed', 'failed'],
  completed: [],
  failed: [],
};

export function isRunStatus(value: unknown): value is RunStatus {
  return typeof value === 'string' && (RUN_STATUSES as readonly string[]).includes(value);
}

export function isTerminal(status: RunStatus): boolean {
  return TRANSITIONS[status].length === 0;
}

/** True iff `next` is a legal successor of `current`. */
export function canTransition(current: RunStatus, next: RunStatus): boolean {
  return TRANSITIONS[current].includes(next);
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
 * Returns `to` so callers can write `status = assertTransition(status, 'running')`. */
export function assertTransition(current: RunStatus, next: RunStatus): RunStatus {
  if (!canTransition(current, next)) {
    throw new InvalidStatusTransitionError(current, next);
  }
  return next;
}
