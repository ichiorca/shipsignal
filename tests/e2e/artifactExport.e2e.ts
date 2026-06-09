// T2/T5 (spec 019) — genuine end-to-end coverage of the approved-artifact export flow against
// the running app: the Gate #2 review page shows export actions ONLY for the approved artifact,
// the run-level bundle link renders, and the export API serves the IMMUTABLE §18.1 snapshot —
// not the mutable artifacts row (the seed deliberately diverges the two) — while refusing the
// non-approved artifact with a user-safe 409. SQL fixture for deterministic seeding (synthetic
// data only, per the GDPR fixture rule; no GitHub/Bedrock/worker dependency).
//
// Prerequisites (see docs/local-dev.md "Browser e2e"): local stack up + bootstrapped, the
// dashboard running, agent-browser installed, and local/dev-env loaded (for DATABASE_URL).
//   RUN_E2E=1 npm run test:e2e
//
// Skips unless RUN_E2E=1 + agent-browser installed + DATABASE_URL set, so CI is unaffected.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
// pg is CommonJS; Node's raw ESM loader can't bind its named exports, so default-import.
import pg from 'pg';
import {
  ab,
  abCount,
  abVisible,
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

// Fresh ids per run so repeated runs never collide and cleanup is precise.
const runId = randomUUID();
const approvedArtifactId = randomUUID();
const draftArtifactId = randomUUID();
const reviewPath = `${BASE_URL}/releases/${runId}/artifacts/review`;

// The snapshot body INTENTIONALLY differs from the mutable row body: the export must serve
// the snapshot (what the reviewer approved), proving §18.1 end-to-end.
const SNAPSHOT_BODY = 'The approved snapshot body.';
const MUTABLE_BODY = 'The mutable row body, edited AFTER approval.';

function dbClient(): pg.Client {
  const ssl = process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false };
  return new pg.Client({ connectionString: DATABASE_URL, ssl });
}

async function seed(): Promise<void> {
  const client = dbClient();
  await client.connect();
  try {
    await client.query(
      `INSERT INTO release_runs
         (id, repo, base_ref, head_ref, trigger_type, status, langgraph_thread_id)
       VALUES ($1, 'octocat/Hello-World', 'main', 'main', 'manual',
               'artifacts_pending_review', $2)`,
      [runId, `lg-e2e-${runId}`],
    );
    await client.query(
      `INSERT INTO artifacts (id, release_run_id, artifact_type, title, body_markdown, status)
       VALUES ($1, $2, 'release_blog', 'E2E approved artifact', $3, 'approved'),
              ($4, $2, 'changelog_entry', 'E2E draft artifact', 'Draft body.', 'draft')`,
      [approvedArtifactId, runId, MUTABLE_BODY, draftArtifactId],
    );
    await client.query(
      `INSERT INTO approved_artifact_snapshots
         (artifact_id, release_run_id, artifact_type, reviewer, reviewer_decision,
          final_title, final_body_markdown, content_hash)
       VALUES ($1, $2, 'release_blog', 'e2e-reviewer', 'approved',
               'E2E approved artifact', $3, 'e2e-content-hash')`,
      [approvedArtifactId, runId, SNAPSHOT_BODY],
    );
  } finally {
    await client.end();
  }
}

async function cleanup(): Promise<void> {
  const client = dbClient();
  await client.connect();
  try {
    // CASCADE removes the artifacts + snapshots (and any outbound deliveries) with the run.
    await client.query('DELETE FROM release_runs WHERE id = $1', [runId]);
  } finally {
    await client.end();
  }
}

before(async () => {
  if (DB_READY) await seed();
});

after(async () => {
  if (DB_READY) {
    closeBrowser();
    await cleanup();
  }
});

test('the review page shows export actions only for the approved artifact, plus the bundle link', { skip }, () => {
  ab(['open', reviewPath]);
  assert.equal(
    abVisible(`[data-export-actions="${approvedArtifactId}"]`),
    true,
    'the approved artifact has export actions',
  );
  assert.equal(
    abCount(`[data-export-actions="${draftArtifactId}"]`),
    0,
    'the draft artifact has none',
  );
  assert.equal(
    abVisible(`a[href="/api/releases/${runId}/artifacts/export"]`),
    true,
    'the run-level JSON bundle link renders',
  );
});

test('the markdown export serves the approved snapshot, not the mutable row', { skip }, async () => {
  const response = await fetch(
    `${BASE_URL}/api/artifacts/${approvedArtifactId}/export?format=markdown`,
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-disposition') ?? '', /attachment/);
  const body = await response.text();
  assert.ok(body.includes(SNAPSHOT_BODY), 'snapshot content is served');
  assert.ok(!body.includes(MUTABLE_BODY), 'post-approval edits never leak into the export');
});

test('the JSON export carries provenance and never the reviewer name', { skip }, async () => {
  const response = await fetch(
    `${BASE_URL}/api/artifacts/${approvedArtifactId}/export?format=json`,
  );
  assert.equal(response.status, 200);
  const raw = await response.text();
  const record = JSON.parse(raw) as { content_hash?: string };
  assert.equal(record.content_hash, 'e2e-content-hash');
  assert.ok(!raw.includes('e2e-reviewer'), 'reviewer identity is excluded from exports');
});

test('a non-approved artifact is refused with a user-safe 409', { skip }, async () => {
  const response = await fetch(
    `${BASE_URL}/api/artifacts/${draftArtifactId}/export?format=markdown`,
  );
  assert.equal(response.status, 409);
  const body = (await response.json()) as { error?: string };
  assert.match(body.error ?? '', /not approved/);
});

test('the run bundle lists exactly the approved artifact', { skip }, async () => {
  const response = await fetch(`${BASE_URL}/api/releases/${runId}/artifacts/export`);
  assert.equal(response.status, 200);
  const bundle = (await response.json()) as {
    artifact_count?: number;
    artifacts?: ReadonlyArray<{ artifact_id?: string }>;
  };
  assert.equal(bundle.artifact_count, 1);
  assert.equal(bundle.artifacts?.[0]?.artifact_id, approvedArtifactId);
});
