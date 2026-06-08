// T2 (spec 015) — AC: the skill-candidate status type supports all 7 §13.3 states via a
// shared, tested guard, and transitions are validated.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SKILL_CANDIDATE_STATUSES,
  isSkillCandidateStatus,
  isSkillCandidateTerminal,
  canTransitionSkillCandidate,
  assertSkillCandidateTransition,
  parseSkillCandidateStatus,
  InvalidSkillCandidateTransitionError,
} from '../app/lib/skillCandidateStatus.ts';

test('all 7 PRD §13.3 states are present', () => {
  assert.deepEqual(
    [...SKILL_CANDIDATE_STATUSES],
    ['draft', 'pending_review', 'approved', 'rejected', 'promoted', 'failed', 'suppressed_duplicate'],
  );
});

test('the guard accepts the seven states and rejects anything else', () => {
  for (const s of SKILL_CANDIDATE_STATUSES) {
    assert.equal(isSkillCandidateStatus(s), true, `${s} should be valid`);
  }
  assert.equal(isSkillCandidateStatus('running'), false);
  assert.equal(isSkillCandidateStatus(''), false);
  assert.equal(isSkillCandidateStatus(7), false);
  assert.equal(isSkillCandidateStatus(undefined), false);
});

test('the staged lifecycle is legal: draft → approved → promoted', () => {
  assert.equal(canTransitionSkillCandidate('draft', 'approved'), true);
  assert.equal(canTransitionSkillCandidate('approved', 'promoted'), true);
  assert.equal(assertSkillCandidateTransition('approved', 'promoted'), 'promoted');
});

test('a draft may be rejected or suppressed; an approved promotion may fail', () => {
  assert.equal(canTransitionSkillCandidate('draft', 'rejected'), true);
  assert.equal(canTransitionSkillCandidate('draft', 'suppressed_duplicate'), true);
  assert.equal(canTransitionSkillCandidate('approved', 'failed'), true);
  // A failed promotion can be retried (re-approved) or rejected.
  assert.equal(canTransitionSkillCandidate('failed', 'approved'), true);
});

test('terminal states are final and reject further transitions', () => {
  assert.equal(isSkillCandidateTerminal('promoted'), true);
  assert.equal(isSkillCandidateTerminal('rejected'), true);
  assert.equal(isSkillCandidateTerminal('suppressed_duplicate'), true);
  assert.equal(isSkillCandidateTerminal('draft'), false);
  assert.equal(canTransitionSkillCandidate('promoted', 'approved'), false);
  assert.equal(canTransitionSkillCandidate('rejected', 'draft'), false);
});

test('assert throws InvalidSkillCandidateTransitionError on an illegal move', () => {
  assert.throws(
    () => assertSkillCandidateTransition('draft', 'promoted'),
    (err: unknown) =>
      err instanceof InvalidSkillCandidateTransitionError &&
      err.from === 'draft' &&
      err.to === 'promoted',
  );
});

test('parseSkillCandidateStatus narrows valid values and throws on drift', () => {
  assert.equal(parseSkillCandidateStatus('draft'), 'draft');
  assert.throws(() => parseSkillCandidateStatus('bogus'), /unexpected skill-candidate status/);
});
