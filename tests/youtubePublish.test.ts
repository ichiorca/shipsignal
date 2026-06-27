// Unit tests for the pure YouTube resource builder (no network, no server-only env): the
// videos.insert resource (clamping + privacy + made-for-kids). The OAuth/upload path
// (youtubePublish.ts) is 'server-only' and exercised via the publish route + mediaPublishLogic.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildVideoResource,
  YOUTUBE_DESCRIPTION_MAX,
  YOUTUBE_TITLE_MAX,
} from '../app/lib/youtube.ts';

test('buildVideoResource sets snippet + status with the chosen privacy', () => {
  const r = buildVideoResource({
    title: 'Demo',
    description: 'A demo video',
    privacyStatus: 'unlisted',
  });
  assert.equal(r.snippet.title, 'Demo');
  assert.equal(r.snippet.description, 'A demo video');
  assert.equal(r.status.privacyStatus, 'unlisted');
  assert.equal(r.status.selfDeclaredMadeForKids, false);
});

test('buildVideoResource clamps title and description to YouTube limits', () => {
  const r = buildVideoResource({
    title: 'x'.repeat(YOUTUBE_TITLE_MAX + 50),
    description: 'y'.repeat(YOUTUBE_DESCRIPTION_MAX + 50),
    privacyStatus: 'private',
  });
  assert.equal(r.snippet.title.length, YOUTUBE_TITLE_MAX);
  assert.equal(r.snippet.description.length, YOUTUBE_DESCRIPTION_MAX);
  assert.equal(r.status.privacyStatus, 'private');
});
