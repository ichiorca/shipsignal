// Genuine end-to-end browser tests for the dashboard, driven by the agent-browser CLI
// (https://github.com/vercel-labs/agent-browser) against a REALLY running app — no mocks.
// Each test exercises the full chain: a headless Chrome → the Next.js UI → the API route
// → Aurora.
//
// Prerequisites (see docs/local-dev.md "Browser e2e"):
//   1. The local stack is up + bootstrapped (Postgres has the schema).
//   2. The dashboard is running:  npm run dev   (default http://localhost:3000)
//   3. agent-browser is installed: npm i -g agent-browser && agent-browser install
//   Then:  RUN_E2E=1 npm run test:e2e
//
// Kept out of the unit gate: the *.e2e.ts suffix is not matched by the unit glob, and every
// test skips unless RUN_E2E=1 AND the CLI is installed — so CI is unaffected.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { ab, abText, abCount, abVisible, BASE_URL, e2eSkip, closeBrowser } from './agentBrowser.ts';

/** Fill the create-run form and submit it. The create surface lives behind a progressive-
 *  disclosure <details> (UI tier-3 #9), so expand it before interacting with the inputs. */
function createRun(repo: string, base: string, head: string): void {
  ab(['open', BASE_URL]);
  ab(['click', 'details[data-new-run] > summary']);
  ab(['fill', '#repo', repo]);
  ab(['fill', '#base_ref', base]);
  ab(['fill', '#head_ref', head]);
  ab(['click', 'text=Create release run']);
}

after(() => closeBrowser());

test('the dashboard home page renders the run feed and a labelled create-run form', { skip: e2eSkip }, () => {
  ab(['open', BASE_URL]);
  assert.equal(abText('h1'), 'Launches');
  // Expand the create disclosure (tier-3 #9) before asserting the form is present + operable.
  ab(['click', 'details[data-new-run] > summary']);
  // The create-run form (the UI we added) is present, with all three labelled inputs.
  assert.equal(abCount('section[aria-labelledby="new-run-heading"]'), 1);
  for (const id of ['repo', 'base_ref', 'head_ref']) {
    assert.equal(abCount(`#${id}`), 1, `input #${id} exists`);
    assert.equal(abCount(`label[for="${id}"]`), 1, `label for #${id} exists`);
  }
  assert.ok(abVisible('form button[type="submit"]'), 'the submit button is visible');
});

test('creating a release run end-to-end shows success and a link into the run', { skip: e2eSkip }, () => {
  // Browser → POST /api/releases → Aurora insert. Dispatch to GitHub may fail locally, in
  // which case the API returns 502-with-run-created and the UI shows a soft success — either
  // way the run row is created and the feedback links to it.
  createRun('octocat/Hello-World', 'main', 'main');
  ab(['wait', '--text', 'created']); // the live region populates after the async POST resolves
  const status = abText('[role="status"]');
  assert.match(status, /release run .* created/i);
  assert.ok(abVisible('[role="status"] a'), 'a link to open the new run is shown');
});

test('an invalid repo slug surfaces the server validation error in the UI', { skip: e2eSkip }, () => {
  // Non-empty (passes the client check) but not owner/repo → the zod boundary rejects it
  // with 400, and the UI renders the server-provided field error.
  createRun('not-a-valid-slug', 'main', 'main');
  ab(['wait', '--text', 'could not be created']);
  const status = abText('[role="status"]');
  assert.match(status, /could not be created/i);
  assert.match(status, /repo/i, 'the field-level zod error names the repo field');
});

test('opening a created run lands on a detail page with breadcrumb + full section nav', { skip: e2eSkip }, () => {
  createRun('octocat/Hello-World', 'main', 'main');
  ab(['wait', '--text', 'created']);
  ab(['click', '[role="status"] a']); // "Open run …"
  ab(['wait', '--url', '**/releases/**']);
  assert.ok(abVisible('nav[aria-label="Breadcrumb"]'), 'breadcrumb is present');
  assert.ok(abVisible('nav[aria-label="Run sections"]'), 'the run section nav is present');
  // The section nav now reaches every per-run screen (Media / Gate #3 / Evals were
  // previously unreachable) — assert the full set is linked.
  assert.ok(abCount('nav[aria-label="Run sections"] a') >= 7, 'all run sections are linked');
});
