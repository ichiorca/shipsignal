// T1 (spec 014) — trigger the media_generation Actions job for an approved feature via
// workflow_dispatch (PRD §14.5 generate-demo). P1 (Substrate): this thin Vercel helper only
// dispatches — the Playwright/ffmpeg/ElevenLabs work runs on the Actions runner, never here.
// github-rules + P5: the token is read server-side from env at call time and never sent to the
// client; the call is run-scoped + idempotent (the worker derives a deterministic per-(run,
// phase) thread), so a retried dispatch advances the same media run rather than forking it.

import 'server-only';
import { requireEnv, optionalEnv } from '@/app/lib/env.ts';
import { assertRepoSlug, assertGitRef } from '@/app/lib/githubRefs.ts';

export interface DispatchMediaGenerationArgs {
  readonly releaseRunId: string;
  // The approved feature whose demo_script the media graph should render. Forwarded to the
  // worker so the demo_script lookup is scoped to this feature (spec 014 T1).
  readonly featureId: string;
}

/**
 * POST a workflow_dispatch that runs the media_generation graph for the run. Throws on a
 * non-2xx response with a message that excludes the token and any response secret.
 */
export async function dispatchMediaGeneration(args: DispatchMediaGenerationArgs): Promise<void> {
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
        // No human gate in this graph (the demo_script is already Gate#2-approved); it runs
        // straight through. feature_id scopes the demo_script to the triggered feature.
        graph: 'media_generation',
        feature_id: args.featureId,
      },
    }),
  });

  if (!response.ok) {
    // Surface status only — never the response body, which may echo headers.
    throw new Error(`media_generation workflow_dispatch failed with status ${response.status}`);
  }
}
