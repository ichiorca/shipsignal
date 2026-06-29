// Shared, pure run-progress helpers (UI tier-1/2 review). One source of truth for "where is
// this run, what should the reviewer do next, and how does its status group" — consumed by the
// home review queue, the run-detail pipeline stepper, and the run list. No DOM / 'server-only',
// so it is usable from Server + Client Components and unit-testable under `node --test`.

import type { ReleaseRun } from '@/app/lib/db/releaseRuns.ts';
import type { RunStatus } from '@/app/lib/runStatus.ts';
// Relative (not '@/') for the VALUE import: the dependency-free `node --test` harness resolves
// runtime imports directly, and only type imports (erased) may use the bundler alias.
import { progressIndex } from './runStatus.ts';

/** The run statuses that mean "halted at a human gate, waiting on a reviewer decision" — the
 *  single source of truth shared by `nextStep`/`isAwaitingReview` (the UI predicate) and
 *  `countRunsAwaitingReview` (the SQL badge count), so the two can never drift. A drift test
 *  asserts `isAwaitingReview` is true for exactly these statuses (tests/runProgress.test.ts). */
export const AWAITING_REVIEW_STATUSES: readonly RunStatus[] = [
  'features_pending_review',
  'artifacts_pending_review',
];

/** The action a reviewer should take next, or null when the run needs no human right now.
 *  Only the two gates the run *status* encodes are surfaced (Gate #3 skill review is tracked by
 *  skill candidates, not run status, so it is not derivable here). */
export function nextStep(run: ReleaseRun): { readonly label: string; readonly href: string } | null {
  switch (run.status) {
    case 'features_pending_review':
      return { label: 'Review the feature manifest (Gate #1)', href: `/releases/${run.id}/review` };
    case 'artifacts_pending_review':
      return {
        label: 'Review the generated artifacts (Gate #2)',
        href: `/releases/${run.id}/artifacts/review`,
      };
    default:
      return null;
  }
}

/** True when the run is halted at a human gate and is waiting on a reviewer decision. */
export function isAwaitingReview(run: ReleaseRun): boolean {
  return nextStep(run) !== null;
}

// --- status grouping (tier-2 #4: collapse ~12 raw statuses into 4 scannable categories) ------

export type StatusCategory = 'awaiting' | 'in_progress' | 'done' | 'failed';

/** Map a raw lifecycle status to one of four reviewer-facing buckets. */
export function statusCategory(status: RunStatus): StatusCategory {
  if (status === 'features_pending_review' || status === 'artifacts_pending_review') {
    return 'awaiting';
  }
  if (status === 'completed') return 'done';
  if (status === 'failed' || status === 'cancelled') return 'failed';
  return 'in_progress';
}

/** Human label for each category (legend + grouping headers). */
export const STATUS_CATEGORY_LABEL: Readonly<Record<StatusCategory, string>> = {
  awaiting: 'Awaiting you',
  in_progress: 'In progress',
  done: 'Done',
  failed: 'Failed / cancelled',
};

// --- pipeline stepper (tier-1 #2) ------------------------------------------------------------

/** State of one lifecycle stage relative to where the run currently is. `awaiting` is a
 *  `current` stage that is halted at a gate needing the reviewer; `halted` is the whole pipeline
 *  when the run failed/was cancelled (position is lost off the linear path). */
export type StageState = 'done' | 'current' | 'awaiting' | 'upcoming' | 'halted';

export interface PipelineStageView {
  readonly key: string;
  readonly label: string;
  /** 1 or 2 when this stage is a human gate; null otherwise. */
  readonly gate: number | null;
  readonly state: StageState;
  /** Link to the stage's screen when it is reachable (done / current / awaiting); null otherwise. */
  readonly href: string | null;
}

interface StageDef {
  readonly key: string;
  readonly label: string;
  readonly gate: number | null;
  /** Progress statuses that mean "the run is currently in this stage". */
  readonly statuses: readonly RunStatus[];
  /** Path for this stage's screen, relative to the run; null = the run hub itself. */
  readonly path: string | null;
}

// A gate stage holds ONLY its `*_pending_review` status, so once the gate is approved (the
// `*_approved` status, which sorts later) the stage reads "done", not "in progress". The
// `*_approved` status belongs to the work that follows it (generate / media).
const STAGES: readonly StageDef[] = [
  { key: 'evidence', label: 'Collect evidence', gate: null, statuses: ['created', 'collecting_evidence', 'evidence_ready'], path: null },
  { key: 'gate1', label: 'Feature review', gate: 1, statuses: ['features_pending_review'], path: '/review' },
  { key: 'artifacts', label: 'Generate artifacts', gate: null, statuses: ['features_approved', 'generating_artifacts'], path: '/artifacts' },
  { key: 'gate2', label: 'Artifact review', gate: 2, statuses: ['artifacts_pending_review'], path: '/artifacts/review' },
  { key: 'media', label: 'Demo media', gate: null, statuses: ['artifacts_approved', 'generating_media'], path: '/media' },
  { key: 'complete', label: 'Complete', gate: null, statuses: ['completed'], path: null },
];

/** Build the lifecycle stepper for a run: each stage tagged done/current/awaiting/upcoming, or
 *  the whole pipeline `halted` when the run failed/was cancelled (its linear position is lost). */
export function buildPipeline(run: ReleaseRun): readonly PipelineStageView[] {
  const ri = progressIndex(run.status); // null for failed/cancelled (off the linear path)
  const awaiting = isAwaitingReview(run);

  return STAGES.map((stage) => {
    const indices = stage.statuses
      .map((s) => progressIndex(s))
      .filter((i): i is number => i !== null);
    const start = Math.min(...indices);
    const end = Math.max(...indices);

    let state: StageState;
    if (ri === null) {
      state = 'halted';
    } else if (ri > end) {
      state = 'done';
    } else if (ri < start) {
      state = 'upcoming';
    } else if (run.status === 'completed') {
      // 'completed' is the terminal — the Complete stage is reached, not "in progress".
      state = 'done';
    } else {
      state = awaiting ? 'awaiting' : 'current';
    }

    const reachable = state === 'done' || state === 'current' || state === 'awaiting';
    const href = reachable && stage.path !== null ? `/releases/${run.id}${stage.path}` : null;
    return { key: stage.key, label: stage.label, gate: stage.gate, state, href };
  });
}
