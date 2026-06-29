// UX review R9 — identify synthetic (demo-seeded) runs so the UI can label them honestly. The
// demo seeder (app/lib/db/demoSeed.ts) stamps every seeded run's langgraph_thread_id with a
// `demo-` prefix, so a run is synthetic iff its thread id starts with that marker. Pure + import-
// free (no DB/server-only) so both server and client components can call it.

import type { ReleaseRun } from '@/app/lib/db/releaseRuns.ts';

/** The prefix the demo seeder writes into every seeded run's langgraph_thread_id. */
export const SYNTHETIC_THREAD_PREFIX = 'demo-';

/** True when this run was created by the demo seeder rather than a real release. */
export function isSyntheticRun(run: Pick<ReleaseRun, 'langgraph_thread_id'>): boolean {
  return run.langgraph_thread_id?.startsWith(SYNTHETIC_THREAD_PREFIX) ?? false;
}

/** True when any run in the set is synthetic — drives a "includes sample data" notice. */
export function hasSyntheticRun(
  runs: readonly Pick<ReleaseRun, 'langgraph_thread_id'>[],
): boolean {
  return runs.some(isSyntheticRun);
}
