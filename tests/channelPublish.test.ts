// Path B / Phase 3 — unit tests for the pure channel post builders. Every post is assembled from
// the approved snapshot and must respect each platform's hard limits and the strict type→channel
// mapping. (The authenticated send + dry-run live in channelDispatch.ts, exercised separately.)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildXPost,
  buildLinkedInPost,
  buildShowHnSubmission,
  isXPublishable,
  isLinkedInPublishable,
  isHackerNewsAssistable,
  X_POST_MAX,
  HN_TITLE_MAX,
  HN_SUBMIT_URL,
} from '../app/lib/channelPublish.ts';
import type { ApprovedSnapshotView } from '../app/lib/artifactExport.ts';

function snapshot(overrides: Partial<ApprovedSnapshotView>): ApprovedSnapshotView {
  return {
    artifact_id: 'art-1',
    release_run_id: 'run-1',
    approval_id: 'appr-1',
    artifact_type: 'x_post',
    model_id: 'bedrock-x',
    prompt_version: 'content-gen-v1',
    skill_versions: {},
    evidence_ids: [],
    claim_support: [],
    reviewer_decision: 'approved',
    final_title: 'Launch',
    final_body_markdown: 'We shipped a thing.',
    content_hash: 'abc',
    generated_at: null,
    approved_at: null,
    ...overrides,
  };
}

test('channel guards map exactly one artifact type each', () => {
  assert.equal(isXPublishable('x_post'), true);
  assert.equal(isXPublishable('linkedin_post'), false);
  assert.equal(isLinkedInPublishable('linkedin_post'), true);
  assert.equal(isLinkedInPublishable('x_post'), false);
  assert.equal(isHackerNewsAssistable('hackernews_post'), true);
  assert.equal(isHackerNewsAssistable('release_blog'), false);
});

test('buildXPost collapses whitespace and never exceeds 280 chars', () => {
  const short = buildXPost(snapshot({ final_body_markdown: 'Ship  faster.\n\nNow live.' }));
  assert.equal(short.text, 'Ship faster. Now live.');

  const long = 'word '.repeat(100).trim(); // 499 chars
  const post = buildXPost(snapshot({ final_body_markdown: long }));
  assert.ok(post.text.length <= X_POST_MAX, `len ${post.text.length} <= ${X_POST_MAX}`);
  assert.ok(post.text.endsWith('…'), 'truncation appends an ellipsis');
  assert.ok(!post.text.includes('  '), 'no double spaces');
});

test('buildLinkedInPost returns the trimmed body for normal-length content', () => {
  const post = buildLinkedInPost(snapshot({ final_body_markdown: '  A LinkedIn announcement.\n\nMore.  ' }));
  assert.equal(post.text, 'A LinkedIn announcement.\n\nMore.');
});

test('buildShowHnSubmission derives a "Show HN:" title from the first line', () => {
  const sub = buildShowHnSubmission(
    snapshot({
      artifact_type: 'hackernews_post',
      final_body_markdown: '# Realtime collaboration\n\nWe added live cursors.\nWorks offline too.',
    }),
  );
  assert.equal(sub.title, 'Show HN: Realtime collaboration');
  assert.equal(sub.text, 'We added live cursors.\nWorks offline too.');
  assert.equal(sub.submitUrl, HN_SUBMIT_URL);
});

test('buildShowHnSubmission does not double-prefix an existing "Show HN:" line', () => {
  const sub = buildShowHnSubmission(
    snapshot({ artifact_type: 'hackernews_post', final_body_markdown: 'Show HN: My tool\n\nbody' }),
  );
  assert.equal(sub.title, 'Show HN: My tool');
});

test('buildShowHnSubmission caps the title at 80 chars', () => {
  const longLine = `A ${'very '.repeat(30)}long title`;
  const sub = buildShowHnSubmission(
    snapshot({ artifact_type: 'hackernews_post', final_body_markdown: `${longLine}\n\nbody` }),
  );
  assert.ok(sub.title.length <= HN_TITLE_MAX, `len ${sub.title.length} <= ${HN_TITLE_MAX}`);
  assert.ok(sub.title.startsWith('Show HN: '));
});
