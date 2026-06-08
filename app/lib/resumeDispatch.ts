// T6 (spec 004) — resume a release run past Gate #1 by dispatching the worker with the
// recorded decision + the SAME thread_id (PRD §5.6 "resume the same thread_id").
// github-rules + P5: the token is read server-side from env at call time, never sent to
// the client; the call is idempotent at the run level (the worker keys off release_run_id
// + thread_id), so a retried resume continues the same thread rather than forking it.

import 'server-only';
import { requireEnv, optionalEnv } from '@/app/lib/env.ts';

export interface ResumeDispatchArgs {
  readonly releaseRunId: string;
  readonly threadId: string;
  readonly decision: 'approved' | 'rejected' | 'edited';
  // Which graph to resume. Gate #1 resumes 'release_intelligence' (default); Gate #2 (spec
  // 006) resumes 'content_generation' past the approve_artifacts interrupt; Gate #3 (spec 009)
  // resumes 'skill_learning' past the approve_skill_candidate interrupt.
  readonly graph?:
    | 'release_intelligence'
    | 'content_generation'
    | 'skill_learning'
    | undefined;
  // Reviewer who resolved the gate. Forwarded to the worker on a Gate #3 resume so the
  // promotion/rejection record names the human who decided (§10.5 reviewed_by); ignored by the
  // other graphs (their reviewer is captured in the approvals audit row).
  readonly reviewer?: string | undefined;
}

/**
 * POST a workflow_dispatch that resumes the halted worker. Throws on a non-2xx response
 * with a message that excludes the token and any response secret.
 */
export async function dispatchResume(args: ResumeDispatchArgs): Promise<void> {
  const token = requireEnv('GITHUB_TOKEN');
  const repo = requireEnv('GITHUB_REPO');
  const workflowFile = optionalEnv('GITHUB_WORKFLOW_FILE', 'release-run.yml');
  const ref = optionalEnv('GITHUB_WORKFLOW_REF', 'main');

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
    body: JSON.stringify({
      ref,
      inputs: {
        release_run_id: args.releaseRunId,
        resume_decision: args.decision,
        thread_id: args.threadId,
        // Default keeps Gate #1 behaviour; Gate #2 passes 'content_generation', Gate #3
        // 'skill_learning'.
        graph: args.graph ?? 'release_intelligence',
        // Forwarded so a Gate #3 promotion/rejection record names the reviewer; '' when absent
        // (the other graphs ignore it). Never a secret — just the reviewer login/email.
        reviewer: args.reviewer ?? '',
      },
    }),
  });

  if (!response.ok) {
    // Surface status only — never the response body, which may echo headers.
    throw new Error(`resume workflow_dispatch failed with status ${response.status}`);
  }
}
