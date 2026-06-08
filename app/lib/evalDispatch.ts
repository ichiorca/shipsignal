// T6 (spec 013) — trigger the product-evaluation worker run after artifact approval (PRD §17 /
// §8 DoD). P1 (Substrate): the Vercel app never computes metrics or runs the rubric — it only
// dispatches the Actions job that does (constitution §1). github-rules + P5: the token is read
// server-side at call time, never sent to the client. Idempotent at the run level — the worker's
// `eval` step keys off release_run_id and the metric/rubric writes are deterministic, so a
// retried dispatch re-evaluates the same run rather than forking it.

import 'server-only';
import { requireEnv, optionalEnv } from '@/app/lib/env.ts';

export interface DispatchEvalArgs {
  readonly releaseRunId: string;
}

/**
 * POST a workflow_dispatch that runs the worker's `eval` step for one run. Throws on a non-2xx
 * response with a message that excludes the token and any response secret.
 */
export async function dispatchEval(args: DispatchEvalArgs): Promise<void> {
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
        // The worker maps graph='eval' to its deterministic eval step (no gate, no resume).
        graph: 'eval',
      },
    }),
  });

  if (!response.ok) {
    // Surface status only — never the response body, which may echo headers.
    throw new Error(`eval workflow_dispatch failed with status ${response.status}`);
  }
}
