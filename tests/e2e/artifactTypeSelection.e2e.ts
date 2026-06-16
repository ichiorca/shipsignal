// T5 (spec 022) — genuine end-to-end coverage of per-run artifact-type selection:
// create a run through the REAL form with a two-type subset (browser → POST /api/releases
// → Aurora), assert the persisted row carries exactly that subset, then seed the run's
// generated drafts and verify the Gate #2 review surface renders ONLY the selected types
// (no empty groups for unselected ones) and names the selection.
//
// Prerequisites mirror gateFlow.e2e.ts (docs/local-dev.md "Browser e2e"): local stack up +
// bootstrapped (migration 0022 applied), dashboard running, agent-browser installed, and
// DATABASE_URL loaded. Run with: RUN_E2E=1 npm run test:e2e — CI is unaffected (skips).
// Uses synthetic fixtures only (domain-gdpr: no real PII).

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
// pg is CommonJS; Node's raw ESM loader can't bind its named exports, so default-import.
import pg from 'pg';
import {
  ab,
  abText,
  abCount,
  BASE_URL,
  E2E_ENABLED,
  e2eSkip,
  closeBrowser,
} from './agentBrowser.ts';

const DATABASE_URL = process.env.DATABASE_URL ?? '';
const DB_READY = E2E_ENABLED && DATABASE_URL !== '';
const skip: string | false = DB_READY
  ? false
  : E2E_ENABLED
    ? 'DATABASE_URL not set — load local/dev-env into the shell running the e2e suite'
    : e2eSkip;

// A unique repo slug per run so the created row is findable and cleanup is precise.
const repoSlug = `octocat/e2e-types-${randomUUID().slice(0, 8)}`;
const SELECTED = ['changelog_entry', 'linkedin_post'] as const;
const DESELECTED = [
  'release_blog',
  'sales_onepager',
  'demo_script',
  'release_audio_digest',
  'customer_email',
  'battlecard_delta',
] as const;

function dbClient(): pg.Client {
  const ssl = process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false };
  return new pg.Client({ connectionString: DATABASE_URL, ssl });
}

let createdRunId: string | null = null;

async function findCreatedRun(): Promise<{ id: string; artifact_types: string[] }> {
  const client = dbClient();
  await client.connect();
  try {
    const result = await client.query<{ id: string; artifact_types: string[] }>(
      'SELECT id, artifact_types FROM release_runs WHERE repo = $1 ORDER BY started_at DESC LIMIT 1',
      [repoSlug],
    );
    assert.ok(result.rows[0], `a release_runs row exists for ${repoSlug}`);
    return result.rows[0];
  } finally {
    await client.end();
  }
}

/** Seed the generated drafts a worker would have produced for the SELECTED subset. */
async function seedDrafts(runId: string): Promise<void> {
  const client = dbClient();
  await client.connect();
  try {
    for (const type of SELECTED) {
      await client.query(
        `INSERT INTO artifacts (release_run_id, artifact_type, title, body_markdown, status)
         VALUES ($1, $2, $3, '# Seeded draft body', 'draft')`,
        [runId, type, `E2E seeded ${type}`],
      );
    }
  } finally {
    await client.end();
  }
}

async function cleanup(): Promise<void> {
  if (!DB_READY) return;
  const client = dbClient();
  await client.connect();
  try {
    // artifacts CASCADE-delete with their run.
    await client.query('DELETE FROM release_runs WHERE repo = $1', [repoSlug]);
  } finally {
    await client.end();
  }
}

after(async () => {
  closeBrowser();
  await cleanup();
});

test('creating a run with a two-type subset persists exactly that selection', { skip }, async () => {
  ab(['open', BASE_URL]);
  ab(['fill', '#repo', repoSlug]);
  ab(['fill', '#base_ref', 'v1.0.0']);
  ab(['fill', '#head_ref', 'v1.1.0']);
  // All six start checked; uncheck everything outside the subset.
  for (const type of DESELECTED) {
    ab(['click', `#artifact-type-${type}`]);
  }
  ab(['click', 'text=Create release run']);
  ab(['wait', '--text', 'created']);
  assert.match(abText('[role="status"]'), /release run .* created/i);

  const run = await findCreatedRun();
  createdRunId = run.id;
  assert.deepEqual([...run.artifact_types].sort(), [...SELECTED].sort());
});

test('the Gate #2 review page renders only the selected types', { skip }, async () => {
  assert.ok(createdRunId, 'run was created by the previous test');
  await seedDrafts(createdRunId as string);

  ab(['open', `${BASE_URL}/releases/${createdRunId}/artifacts/review`]);
  // The page names the run's selection (spec 022 T4).
  assert.match(
    abText('main'),
    /Artifact types selected for this run: Changelog entry, LinkedIn \/ social post\./,
  );
  // Exactly the two seeded artifacts render, grouped under exactly the two selected
  // types — and no group exists for any unselected type (no empty groups, spec AC).
  const body = abText('main');
  assert.match(body, /E2E seeded changelog_entry/);
  assert.match(body, /E2E seeded linkedin_post/);
  assert.equal(abCount('section[data-artifact-status]'), 2);
  assert.equal(abCount('section[data-artifact-type-group]'), 2);
  for (const selectedType of SELECTED) {
    assert.equal(abCount(`section[data-artifact-type-group="${selectedType}"]`), 1);
  }
  for (const absentType of DESELECTED) {
    assert.equal(
      abCount(`section[data-artifact-type-group="${absentType}"]`),
      0,
      `${absentType} has no group on the review page`,
    );
  }
});
