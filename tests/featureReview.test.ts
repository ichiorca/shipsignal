// T5/T6 (spec 004) — boundary validation for the Gate #1 review action inputs.
// P5 (Safety rails): every approve/reject/edit/resume body is untrusted; these tests
// pin the contract that a decision cannot be recorded without an accountable reviewer,
// that unknown keys are rejected (no silent passthrough), and that an "edit" must change
// at least one field. Exercised through the public parseBody surface the routes call.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decisionSchema,
  editSchema,
  resumeSchema,
  parseBody,
} from '../app/lib/featureReview.ts';

test('decision accepts a reviewer (+ optional notes)', () => {
  const result = parseBody(decisionSchema, { reviewer: 'alice', notes: 'looks good' });
  assert.ok(result.ok);
  assert.equal(result.value.reviewer, 'alice');
});

test('decision rejects a missing/empty reviewer (no anonymous approval)', () => {
  for (const body of [{}, { reviewer: '' }, { reviewer: '   ' }]) {
    const result = parseBody(decisionSchema, body);
    assert.equal(result.ok, false);
  }
});

test('decision rejects unknown keys (strict)', () => {
  const result = parseBody(decisionSchema, { reviewer: 'alice', approved: true });
  assert.equal(result.ok, false);
});

test('edit requires at least one edited field', () => {
  const empty = parseBody(editSchema, { reviewer: 'alice', edits: {} });
  assert.equal(empty.ok, false);

  const ok = parseBody(editSchema, {
    reviewer: 'alice',
    edits: { user_value: 'Sharper value prop' },
  });
  assert.ok(ok.ok);
  assert.equal(ok.value.edits.user_value, 'Sharper value prop');
});

test('edit rejects an unknown edit field (strict — only narrative fields)', () => {
  const result = parseBody(editSchema, {
    reviewer: 'alice',
    edits: { marketability_score: 1 },
  });
  assert.equal(result.ok, false);
});

test('resume requires a reviewer and a known decision; thread_id is optional (server-derived)', () => {
  const ok = parseBody(resumeSchema, {
    reviewer: 'alice',
    decision: 'approved',
    thread_id: 'lg_abc',
  });
  assert.ok(ok.ok);

  const badDecision = parseBody(resumeSchema, {
    reviewer: 'alice',
    decision: 'maybe',
    thread_id: 'lg_abc',
  });
  assert.equal(badDecision.ok, false);

  // thread_id is now IGNORED (the server derives it from the path run id + graph), so omitting
  // it is valid — a client can no longer point the resume at another run's gate thread.
  const noThread = parseBody(resumeSchema, { reviewer: 'alice', decision: 'approved' });
  assert.equal(noThread.ok, true);
});
