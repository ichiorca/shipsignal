// T6 (spec 004) — resume a release run past Gate #1 by dispatching the worker with the
// recorded decision + the SAME thread_id (PRD §5.6 "resume the same thread_id").
// github-rules + P5: the token is read server-side from env at call time, never sent to
// the client; the call is idempotent at the run level (the worker keys off release_run_id
// + thread_id), so a retried resume continues the same thread rather than forking it.

import 'server-only';
import { requireEnv, optionalEnv } from '@/app/lib/env.ts';
import { assertRepoSlug, assertGitRef } from '@/app/lib/githubRefs.ts';

export type ResumeGraph =
  | 'release_intelligence'
  | 'content_generation'
  | 'skill_learning';

// release_run_id is a UUID from a trusted internal row, but it is threaded into a checkpoint key,
// so we validate its shape here (mirrors the worker's loop_orchestration._RUN_ID_RE) before
// deriving a thread id from it.
const RUN_ID_RE = /^[0-9a-zA-Z][0-9a-zA-Z._-]{0,127}$/;

/** Derive the SAME LangGraph thread id the worker uses for ``(release_run_id, graph)``
 *  (``loop_orchestration.thread_id_for`` → ``lg_<run>_<graph>``). Deriving it server-side from
 *  the path run id + the route's graph means a client cannot point an approval recorded for one
 *  run at a *different* run's halted gate thread (constitution §5 — gate audit↔action binding). */
export function resumeThreadId(releaseRunId: string, graph: ResumeGraph): string {
  if (!RUN_ID_RE.test(releaseRunId)) {
    throw new Error('release_run_id is empty or has an unexpected shape');
  }
  return `lg_${releaseRunId}_${graph}`;
}

export interface ResumeDispatchArgs {
  readonly releaseRunId: string;
  readonly decision: 'approved' | 'rejected' | 'edited';
  // Which graph to resume. Gate #1 resumes 'release_intelligence' (default); Gate #2 (spec
  // 006) resumes 'content_generation' past the approve_artifacts interrupt; Gate #3 (spec 009)
  // resumes 'skill_learning' past the approve_skill_candidate interrupt. The thread id is
  // DERIVED from (releaseRunId, graph) — never accepted from the client.
  readonly graph?: ResumeGraph | undefined;
  // Reviewer who resolved the gate. Forwarded to the worker on a Gate #3 resume so the
  // promotion/rejection record names the human who decided (§10.5 reviewed_by); ignored by the
  // other graphs (their reviewer is captured in the approvals audit row).
  readonly reviewer?: string | undefined;
  // PRD §14.4 — when this Gate #3 resume is for a SINGLE skill candidate (the per-candidate
  // programmatic surface), the candidate id is forwarded so the worker promotes/rejects only that
  // draft. Omitted by the dashboard's run-level resume (→ the worker decides every draft, as
  // before). Scopes the single repo write so approving one candidate never overwrites a sibling's
  // SKILL.md that no human approved (constitution §5).
  readonly candidateId?: string | undefined;
}

/**
 * POST a workflow_dispatch that resumes the halted worker. Throws on a non-2xx response
 * with a message that excludes the token and any response secret.
 */
export async function dispatchResume(args: ResumeDispatchArgs): Promise<void> {
  const graph: ResumeGraph = args.graph ?? 'release_intelligence';
  // Derive the thread id server-side from the (trusted, path-supplied) run id + this graph, so a
  // client-supplied value can never resume a different run's gate thread (constitution §5).
  const threadId = resumeThreadId(args.releaseRunId, graph);
  const token = requireEnv('GITHUB_TOKEN');
  // Validate the env-supplied repo/ref before they go into the URL/body (no injection).
  const repo = assertRepoSlug(requireEnv('GITHUB_REPO'));
  const workflowFile = optionalEnv('GITHUB_WORKFLOW_FILE', 'release-run.yml');
  const ref = assertGitRef(optionalEnv('GITHUB_WORKFLOW_REF', 'main'));

  const url = `https://api.github.com/repos/${repo}/actions/workflows/${encodeURIComponent(
    workflowFile,
  )}/dispatches`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(10_000),
    body: JSON.stringify({
      ref,
      inputs: {
        release_run_id: args.releaseRunId,
        resume_decision: args.decision,
        thread_id: threadId,
        // Default keeps Gate #1 behaviour; Gate #2 passes 'content_generation', Gate #3
        // 'skill_learning'.
        graph,
        // Forwarded so a Gate #3 promotion/rejection record names the reviewer; '' when absent
        // (the other graphs ignore it). Never a secret — just the reviewer login/email.
        reviewer: args.reviewer ?? '',
        // PRD §14.4 — scopes a Gate #3 resume to one skill candidate; '' (run-level resume) lets
        // the worker decide every draft, as before. Ignored by the other graphs.
        candidate_id: args.candidateId ?? '',
      },
    }),
  });

  if (!response.ok) {
    // Surface status only — never the response body, which may echo headers.
    throw new Error(`resume workflow_dispatch failed with status ${response.status}`);
  }
}
