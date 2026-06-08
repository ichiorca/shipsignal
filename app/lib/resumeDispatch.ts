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
      },
    }),
  });

  if (!response.ok) {
    // Surface status only — never the response body, which may echo headers.
    throw new Error(`resume workflow_dispatch failed with status ${response.status}`);
  }
}
