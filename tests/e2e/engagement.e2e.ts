// T3/T4/T5 (spec 021) — genuine end-to-end coverage of the engagement outcome loop against
// the running app, through the SAME surfaces the operator uses (anti-pattern #4):
//   * the markdown export of an approved artifact carries UTM-stamped links (T2);
//   * POST /api/releases/{id}/engagement accepts a JSON batch, is idempotent on re-post,
//     rejects unexpected (user-level) fields, and rejects cross-run artifact ids (T3);
//   * the CSV door accepts a template-shaped upload as source 'manual_csv' (T4);
//   * the cost page renders the upload panel and the ROI table with reported numbers
//     next to "not yet reported" (T4/T5).
// SQL fixture for deterministic seeding (synthetic data only, per the GDPR fixture rule).
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
const blogArtifactId = randomUUID();
const changelogArtifactId = randomUUID();
const foreignRunId = randomUUID();
const foreignArtifactId = randomUUID();
const engagementUrl = () => `${BASE_URL}/api/releases/${runId}/engagement`;

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
       VALUES ($1, 'octocat/Hello-World', 'main', 'main', 'manual', 'completed', $2),
              ($3, 'octocat/Other-Repo', 'main', 'main', 'manual', 'completed', $4)`,
      [runId, `lg-e2e-${runId}`, foreignRunId, `lg-e2e-${foreignRunId}`],
    );
    await client.query(
      `INSERT INTO artifacts (id, release_run_id, artifact_type, title, body_markdown, status)
       VALUES ($1, $2, 'release_blog', 'E2E blog', 'Blog body.', 'approved'),
              ($3, $2, 'changelog_entry', 'E2E changelog', 'Changelog body.', 'draft'),
              ($5, $4, 'release_blog', 'Foreign artifact', 'Foreign body.', 'draft')`,
      [blogArtifactId, runId, changelogArtifactId, foreignArtifactId, foreignRunId],
    );
    // An approved snapshot WITH an absolute link, to prove export-time UTM stamping (T2).
    await client.query(
      `INSERT INTO approved_artifact_snapshots
         (artifact_id, release_run_id, artifact_type, reviewer, reviewer_decision,
          final_title, final_body_markdown, content_hash)
       VALUES ($1, $2, 'release_blog', 'e2e-reviewer', 'approved', 'E2E blog',
               'Read the [docs](https://example.com/docs).', 'e2e-content-hash')`,
      [blogArtifactId, runId],
    );
  } finally {
    await client.end();
  }
}

async function cleanup(): Promise<void> {
  const client = dbClient();
  await client.connect();
  try {
    // CASCADE removes artifacts, snapshots, and engagement_metrics with their runs.
    await client.query('DELETE FROM release_runs WHERE id = ANY($1::uuid[])', [
      [runId, foreignRunId],
    ]);
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

function jsonPost(body: unknown): Promise<Response> {
  return fetch(engagementUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('the markdown export stamps absolute links with the run-scoped UTM params', { skip }, async () => {
  const response = await fetch(
    `${BASE_URL}/api/artifacts/${blogArtifactId}/export?format=markdown`,
  );
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.ok(
    body.includes(
      `[docs](https://example.com/docs?utm_source=shipsignal&utm_medium=release_blog&utm_campaign=${runId})`,
    ),
    'the exported link carries utm_source/medium/campaign',
  );
});

test('a JSON batch ingests and re-posting the same key is idempotent', { skip }, async () => {
  const row = { artifact_id: blogArtifactId, metric: 'views', value: 1200, as_of: '2026-06-08' };
  const first = await jsonPost({ rows: [row] });
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), { release_run_id: runId, accepted: 1, source: 'api' });

  // Same (artifact, metric, as_of, source) with a corrected value → the row converges.
  const second = await jsonPost({ rows: [{ ...row, value: 1300 }] });
  assert.equal(second.status, 200);

  const client = dbClient();
  await client.connect();
  try {
    const result = await client.query(
      `SELECT value::int AS value, COUNT(*) OVER () AS rows
         FROM engagement_metrics WHERE release_run_id = $1 AND metric = 'views'`,
      [runId],
    );
    assert.equal(result.rows.length, 1, 'one row per idempotency key');
    assert.equal(result.rows[0]?.value, 1300, 'the upsert overwrote the value');
  } finally {
    await client.end();
  }
});

test('rows with unexpected (user-level) fields are rejected with a user-safe 400', { skip }, async () => {
  const response = await jsonPost({
    rows: [
      {
        artifact_id: blogArtifactId,
        metric: 'views',
        value: 5,
        as_of: '2026-06-08',
        user_id: 'smuggled-user',
      },
    ],
  });
  assert.equal(response.status, 400);
  const body = (await response.json()) as { error?: string };
  assert.match(body.error ?? '', /invalid engagement batch/);

  const client = dbClient();
  await client.connect();
  try {
    const result = await client.query(
      'SELECT COUNT(*)::int AS n FROM engagement_metrics WHERE release_run_id = $1',
      [runId],
    );
    assert.equal(result.rows[0]?.n, 1, 'nothing from the rejected batch was persisted');
  } finally {
    await client.end();
  }
});

test('an artifact id from another run is rejected — no cross-run bleed', { skip }, async () => {
  const response = await jsonPost({
    rows: [{ artifact_id: foreignArtifactId, metric: 'clicks', value: 3, as_of: '2026-06-08' }],
  });
  assert.equal(response.status, 400);
  const body = (await response.json()) as { details?: readonly string[] };
  assert.match(body.details?.[0] ?? '', /does not belong to this release run/);
});

test('the CSV door ingests a template-shaped upload as manual_csv', { skip }, async () => {
  const csv =
    'artifact_id,metric,value,as_of\n' +
    `${blogArtifactId},clicks,40,2026-06-08\n` +
    `${changelogArtifactId},views,90,2026-06-08\n`;
  const form = new FormData();
  form.append('file', new File([csv], 'engagement.csv', { type: 'text/csv' }));
  const response = await fetch(engagementUrl(), { method: 'POST', body: form });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    release_run_id: runId,
    accepted: 2,
    source: 'manual_csv',
  });
});

test('the cost page shows the upload panel and the ROI table with partial data', { skip }, () => {
  ab(['open', `${BASE_URL}/releases/${runId}/cost`]);
  assert.equal(abVisible('#engagement-upload-heading'), true, 'the upload panel renders');
  assert.equal(abVisible('#roi-heading'), true, 'the ROI section renders');
  assert.equal(
    abVisible('tr[data-artifact-type="release_blog"]'),
    true,
    'the blog row renders',
  );
  // The blog has views+clicks; conversions were never reported anywhere → the AC text.
  const blogRow = String(ab(['get', 'text', 'tr[data-artifact-type="release_blog"]']));
  assert.match(blogRow, /1,300/);
  assert.match(blogRow, /not yet reported/);
});
