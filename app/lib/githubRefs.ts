// Validators for the GitHub repo slug + git ref BEFORE they are interpolated into a GitHub
// API URL/body. The request path (releaseInput.ts) already validates user-supplied repo/ref;
// these guard the ENV-supplied values (GITHUB_REPO / GITHUB_WORKFLOW_REF) the dispatch helpers
// send with the worker's Bearer token, so a malformed/poisoned env can't redirect that
// authenticated call (no path/URL injection). Server-only — never bundled for the client.

import 'server-only';

// GitHub's own allowed charset for owner/repo; exactly one '/'. Matches releaseInput.ts.
const REPO_SLUG_RE = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;
// A git ref (branch/tag/SHA): no whitespace or the ref-name metacharacters git forbids.
const GIT_REF_RE = /^[^\s~^:?*[\\]+$/;

/** Assert `repo` is a safe `owner/repo` slug (so it can be interpolated into the API path). */
export function assertRepoSlug(repo: string): string {
  if (!REPO_SLUG_RE.test(repo)) {
    throw new Error('GITHUB_REPO must be "owner/repo"');
  }
  return repo;
}

/** Assert `ref` is a safe git ref before it is sent to the GitHub API. */
export function assertGitRef(ref: string): string {
  if (ref.length > 255 || !GIT_REF_RE.test(ref)) {
    throw new Error('GITHUB_WORKFLOW_REF is not a valid git ref');
  }
  return ref;
}
