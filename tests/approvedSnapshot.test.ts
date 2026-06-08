// T2/T5 (spec 016) — assembling the §18.3 immutable approved-content record. Proves the pure
// builder captures every §18.3 field (model/prompt/skill versions, evidence ids, claim support,
// reviewer + decision, final content + its stable hash), so the snapshot written at Gate #2
// approval is a faithful, tamper-evident copy distinct from the mutable artifact row.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApprovedSnapshot } from '../app/lib/approvedSnapshot.ts';
import { artifactContentHash } from '../app/lib/contentHash.ts';
import type { ArtifactWithClaims } from '../app/lib/db/claims.ts';

function artifact(overrides: Partial<ArtifactWithClaims> = {}): ArtifactWithClaims {
  return {
    id: 'art-1',
    release_run_id: 'run-1',
    artifact_type: 'release_blog',
    title: 'Release highlights',
    body_markdown: 'Admins can create onboarding checklists.',
    status: 'draft',
    claims: [
      {
        id: 'claim-1',
        artifact_id: 'art-1',
        claim_text: 'Admins can create checklists.',
        claim_type: 'capability',
        support_status: 'supported',
        risk_level: 'low',
        evidence: [
          { evidence_item_id: 'ev-2', evidence_type: 'diff', redacted_excerpt: 'x', support_score: 0.9 },
          { evidence_item_id: 'ev-1', evidence_type: 'pr', redacted_excerpt: 'y', support_score: 0.8 },
        ],
      },
      {
        id: 'claim-2',
        artifact_id: 'art-1',
        claim_text: 'Now faster.',
        claim_type: 'performance',
        support_status: 'supported',
        risk_level: 'medium',
        evidence: [
          { evidence_item_id: 'ev-2', evidence_type: 'diff', redacted_excerpt: 'x', support_score: 0.7 },
        ],
      },
    ],
    ...overrides,
  };
}

const audit = {
  model_id: 'bedrock-model-x',
  prompt_version: 'content-gen-v1',
  skill_versions: { 'brand-voice': 'hash-abc' },
  generated_at: '2026-06-01T00:00:00.000Z',
};

const approval = { reviewer: 'alice@example.com', decision: 'approved', approval_id: 'appr-1' };

test('captures every §18.3 audit field on the snapshot', () => {
  const rec = buildApprovedSnapshot(artifact(), audit, approval);
  assert.equal(rec.artifact_id, 'art-1');
  assert.equal(rec.release_run_id, 'run-1');
  assert.equal(rec.approval_id, 'appr-1');
  assert.equal(rec.model_id, 'bedrock-model-x');
  assert.equal(rec.prompt_version, 'content-gen-v1');
  assert.deepEqual(rec.skill_versions, { 'brand-voice': 'hash-abc' });
  assert.equal(rec.reviewer, 'alice@example.com');
  assert.equal(rec.reviewer_decision, 'approved');
  assert.equal(rec.generated_at, '2026-06-01T00:00:00.000Z');
});

test('de-dups and sorts evidence ids across all claims', () => {
  const rec = buildApprovedSnapshot(artifact(), audit, approval);
  assert.deepEqual(rec.evidence_ids, ['ev-1', 'ev-2']);
});

test('projects each claim support status + risk level', () => {
  const rec = buildApprovedSnapshot(artifact(), audit, approval);
  assert.deepEqual(rec.claim_support, [
    { claim_id: 'claim-1', support_status: 'supported', risk_level: 'low' },
    { claim_id: 'claim-2', support_status: 'supported', risk_level: 'medium' },
  ]);
});

test('content hash is the stable digest of the final approved content', () => {
  const rec = buildApprovedSnapshot(artifact(), audit, approval);
  assert.equal(
    rec.content_hash,
    artifactContentHash('Release highlights', 'Admins can create onboarding checklists.'),
  );
  // Snapshotting the same content again yields the identical hash (tamper-evident + stable).
  const again = buildApprovedSnapshot(artifact(), audit, approval);
  assert.equal(again.content_hash, rec.content_hash);
});

test('records the final (possibly edited) body, and a null title canonicalizes to empty', () => {
  const edited = artifact({ title: null, body_markdown: 'Edited approved copy.' });
  const rec = buildApprovedSnapshot(edited, audit, approval);
  assert.equal(rec.final_title, null);
  assert.equal(rec.final_body_markdown, 'Edited approved copy.');
  assert.equal(rec.content_hash, artifactContentHash('', 'Edited approved copy.'));
});
