// Genuine end-to-end test of the Gate #1 approval flow — the safety-critical path the
// B1/B2 fixes hardened — driven by a real headless Chrome (agent-browser) against the
// running app, with a SQL fixture for deterministic seeding (no GitHub/Bedrock/worker
// dependency). It proves: the seeded pending feature renders; the gate decision is
// DISABLED until a reviewer is named; Approve opens an accessible confirmation dialog
// stating the consequence; Cancel dismisses it WITHOUT resuming; and confirming records
// the human decision in Aurora (browser → API route → DB).
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
  abText,
  abCount,
  abVisible,
  abEnabled,
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
const featureId = randomUUID();
const threadId = `lg-e2e-${runId}`;
const reviewer = 'e2e-reviewer';
const reviewPath = `${BASE_URL}/releases/${runId}/review`;

function dbClient(): pg.Client {
  const ssl = process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false };
  return new pg.Client({ connectionString: DATABASE_URL, ssl });
}

async function seed(): Promise<void> {
  const client = dbClient();
  await client.connect();
  try {
    // A run halted at Gate #1 with a thread to resume (threadId must be non-null or the
    // gate buttons stay disabled), plus one pending feature for the reviewer to act on.
    await client.query(
      `INSERT INTO release_runs
         (id, repo, base_ref, head_ref, trigger_type, status, langgraph_thread_id)
       VALUES ($1, 'octocat/Hello-World', 'main', 'main', 'manual',
               'features_pending_review', $2)`,
      [runId, threadId],
    );
    await client.query(
      `INSERT INTO feature_clusters
         (id, release_run_id, title, user_value,
          marketability_score, demoability_score, confidence, status)
       VALUES ($1, $2, 'E2E seeded feature', 'A clearly testable user value.',
               0.80, 0.90, 0.85, 'pending_review')`,
      [featureId, runId],
    );
  } finally {
    await client.end();
  }
}

async function cleanup(): Promise<void> {
  const client = dbClient();
  await client.connect();
  try {
    await client.query('DELETE FROM approvals WHERE target_id = $1', [runId]);
    // CASCADE removes the feature + any links with the run.
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

test('Gate #1: the seeded pending feature renders and the gate is disabled until a reviewer is named', { skip }, () => {
  ab(['open', reviewPath]);
  assert.ok(abCount('section[data-feature-id]') >= 1, 'the pending feature section renders');
  assert.match(abText('section[data-feature-id] h2'), /E2E seeded feature/);
  // No reviewer yet → the run-level gate decision must not be actionable (no self-approval).
  assert.equal(abEnabled('[data-testid="manifest-approve"]'), false, 'Approve is disabled without a reviewer');
  assert.equal(abEnabled('[data-testid="manifest-reject"]'), false, 'Reject is disabled without a reviewer');
});

test('Gate #1: Approve opens an accessible confirmation dialog stating the consequence, and Cancel dismisses it', { skip }, () => {
  ab(['open', reviewPath]);
  ab(['fill', '#reviewer', reviewer]);
  assert.equal(abEnabled('[data-testid="manifest-approve"]'), true, 'naming a reviewer enables the gate');

  ab(['click', '[data-testid="manifest-approve"]']);
  ab(['wait', 'dialog']); // the native <dialog> opened via showModal()
  assert.equal(abVisible('dialog'), true, 'the confirmation dialog is shown');
  const dialogText = abText('dialog');
  assert.match(dialogText, /Gate #1/, 'the dialog states the consequence');
  assert.match(dialogText, /Approve & resume/, 'the confirm action is present');

  // Cancel must dismiss WITHOUT resuming the worker.
  ab(['click', 'text=Cancel']);
  assert.equal(abCount('dialog'), 0, 'the dialog is dismissed on cancel');
});

test('Gate #1: confirming Approve records the human decision in Aurora (browser → API → DB)', { skip }, async () => {
  ab(['open', reviewPath]);
  ab(['fill', '#reviewer', reviewer]);
  ab(['click', '[data-testid="manifest-approve"]']);
  ab(['wait', 'dialog']);
  ab(['click', '[data-confirm="true"]']); // "Approve & resume"
  ab(['wait', '--text', 'manifest']); // the status region updates once the POST resolves

  // The resume route records the gate decision in `approvals` BEFORE it dispatches the
  // worker — so whether or not the local GitHub dispatch succeeds, the human's approval is
  // durably recorded. Assert it actually landed in Aurora.
  const client = dbClient();
  await client.connect();
  try {
    const result = await client.query<{ decision: string; reviewer: string }>(
      `SELECT decision, reviewer FROM approvals
        WHERE target_type = 'feature_manifest' AND target_id = $1
        ORDER BY created_at DESC LIMIT 1`,
      [runId],
    );
    assert.equal(result.rows.length, 1, 'a gate approval row was recorded');
    assert.equal(result.rows[0]?.decision, 'approved');
    assert.equal(result.rows[0]?.reviewer, reviewer);
  } finally {
    await client.end();
  }
});
