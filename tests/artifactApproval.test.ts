// Unit coverage for the Gate #2 safety predicate (constitution §5): an artifact is approvable
// ONLY if it is not blocked, not awaiting re-validation after an edit, and every claim is
// supported with >=1 evidence link. This pins the H2 fix (edited → not approvable) and the
// core "no unsupported/unlinkable claim reaches approved" rule.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isApprovable } from '../app/lib/artifactApproval.ts';
import type { ArtifactWithClaims } from '../app/lib/db/claims.ts';

function artifact(overrides: Partial<ArtifactWithClaims> = {}): ArtifactWithClaims {
  return {
    id: 'aaaaaaaa-1111-2222-3333-444444444444',
    release_run_id: 'rrrrrrrr-1111-2222-3333-444444444444',
    artifact_type: 'release_blog',
    title: 'Title',
    body_markdown: '# Body',
    status: 'draft',
    claims: [
      {
        id: 'c1111111-1111-2222-3333-444444444444',
        artifact_id: 'aaaaaaaa-1111-2222-3333-444444444444',
        claim_text: 'A supported claim.',
        claim_type: 'capability',
        support_status: 'supported',
        risk_level: 'low',
        evidence: [
          {
            evidence_item_id: 'e1111111-1111-2222-3333-444444444444',
            evidence_type: 'ui_string_change',
            redacted_excerpt: 'Add button',
            support_score: 0.6,
          },
        ],
      },
    ],
    ...overrides,
  };
}

test('a draft whose every claim is supported + linked is approvable', () => {
  assert.equal(isApprovable(artifact()), true);
});

test('a blocked artifact is never approvable', () => {
  assert.equal(isApprovable(artifact({ status: 'blocked' })), false);
});

test('an edited artifact is never approvable (must be re-validated first)', () => {
  assert.equal(isApprovable(artifact({ status: 'edited' })), false);
});

test('an unsupported claim makes the artifact not approvable', () => {
  const a = artifact();
  const blocked = artifact({
    claims: [{ ...a.claims[0]!, support_status: 'unsupported' }],
  });
  assert.equal(isApprovable(blocked), false);
});

test('a supported claim with zero evidence links is not approvable', () => {
  const a = artifact();
  const noEvidence = artifact({ claims: [{ ...a.claims[0]!, evidence: [] }] });
  assert.equal(isApprovable(noEvidence), false);
});

test('an artifact with no claims is NOT approvable (zero claim-level provenance, §8)', () => {
  // `.every` is vacuously true on an empty array; a zero-claim artifact has nothing linking it
  // to evidence, so Gate #2 must refuse it rather than publish unprovenanced content.
  assert.equal(isApprovable(artifact({ claims: [] })), false);
});
