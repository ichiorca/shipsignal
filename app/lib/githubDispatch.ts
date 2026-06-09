// T3 (spec 001) — trigger the release-run Actions job via workflow_dispatch.
// github-rules + P5: the token is read server-side from env at call time and never
// sent to the client; the call is idempotent at the run level because the caller
// passes the already-created release_run_id as an input, so a retried dispatch
// advances the same run rather than creating a new one.

import 'server-only';
import { requireEnv, optionalEnv } from '@/app/lib/env.ts';
import { assertRepoSlug, assertGitRef } from '@/app/lib/githubRefs.ts';

export interface DispatchReleaseRunArgs {
  readonly releaseRunId: string;
  readonly repo: string;
  readonly baseRef: string;
  readonly headRef: string;
}

/**
 * POST a workflow_dispatch to the configured release-run workflow. Throws on a
 * non-2xx response with a message that excludes the token and response secrets.
 */
export async function dispatchReleaseRunWorkflow(args: DispatchReleaseRunArgs): Promise<void> {
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
    body: JSON.stringify({
      ref,
      inputs: {
        release_run_id: args.releaseRunId,
        repo: args.repo,
        base_ref: args.baseRef,
        head_ref: args.headRef,
      },
    }),
  });

  if (!response.ok) {
    // Surface status only — never the response body, which may echo back headers.
    throw new Error(`workflow_dispatch failed with status ${response.status}`);
  }
}
