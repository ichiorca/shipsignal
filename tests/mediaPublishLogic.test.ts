// Unit tests for decideMediaPublish — the gates, dry-run branch, two-phase idempotency, success,
// and failure-cleanup paths of publishing a demo video to YouTube. Pure: every effect is a fake,
// so no Aurora/S3/YouTube is touched (mirrors channelPublishLogic.test.ts).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideMediaPublish } from '../app/lib/mediaPublishLogic.ts';
import type { MediaPublishCommand, MediaPublishDeps } from '../app/lib/mediaPublishLogic.ts';
import type { MediaForPublish } from '../app/lib/db/mediaAssets.ts';
import type { DispatchAcquire } from '../app/lib/db/approvals.ts';

const READY_VIDEO: MediaForPublish = {
  release_run_id: 'run-1',
  media_type: 'demo_video',
  status: 'ready',
  s3_uri: 's3://media/run-1/vid.mp4',
  content_type: 'video/mp4',
  external_url: null,
};

const CMD: MediaPublishCommand = {
  mediaId: 'aaaaaaaa-1111-2222-3333-444444444444',
  platform: 'youtube',
  reviewer: 'alice',
  title: 'Demo',
  description: 'A demo',
};

interface Calls {
  began: number;
  completed: number;
  deleted: number;
  fetched: number;
  published: number;
  recorded: { url: string; videoId: string | null; publishedBy: string }[];
}

function deps(
  overrides: Partial<MediaPublishDeps> & { media?: MediaForPublish | null; acquire?: DispatchAcquire },
): { deps: MediaPublishDeps; calls: Calls } {
  const calls: Calls = {
    began: 0,
    completed: 0,
    deleted: 0,
    fetched: 0,
    published: 0,
    recorded: [],
  };
  // Distinguish "media: null" (asset absent) from "not provided" (default to the ready video).
  const media: MediaForPublish | null = 'media' in overrides ? (overrides.media ?? null) : READY_VIDEO;
  const base: MediaPublishDeps = {
    getMedia: async () => media,
    willDryRun: () => false,
    beginDispatch: async () => {
      calls.began += 1;
      return overrides.acquire ?? { kind: 'acquired', id: 'app-1' };
    },
    completeDispatch: async () => {
      calls.completed += 1;
    },
    deleteApproval: async () => {
      calls.deleted += 1;
    },
    fetchVideoBytes: async () => {
      calls.fetched += 1;
      return { bytes: new Uint8Array([1, 2, 3]), contentType: 'video/mp4' };
    },
    publish: async () => {
      calls.published += 1;
      return { videoId: 'YT123', url: 'https://youtu.be/YT123', dryRun: false };
    },
    recordPublication: async (_mediaId, pub) => {
      calls.recorded.push({ url: pub.url, videoId: pub.videoId, publishedBy: pub.publishedBy });
    },
  };
  return { deps: { ...base, ...overrides }, calls };
}

test('404 when the media asset does not exist', async () => {
  const { deps: d } = deps({ media: null });
  const r = await decideMediaPublish(CMD, d);
  assert.equal(r.status, 404);
});

test('409 when the asset is not a demo video', async () => {
  const { deps: d } = deps({ media: { ...READY_VIDEO, media_type: 'release_audio_digest' } });
  const r = await decideMediaPublish(CMD, d);
  assert.equal(r.status, 409);
});

test('409 when the demo video is not ready', async () => {
  const { deps: d } = deps({ media: { ...READY_VIDEO, status: 'broken' } });
  const r = await decideMediaPublish(CMD, d);
  assert.equal(r.status, 409);
});

test('409 when the asset has no stored video', async () => {
  const { deps: d } = deps({ media: { ...READY_VIDEO, s3_uri: null } });
  const r = await decideMediaPublish(CMD, d);
  assert.equal(r.status, 409);
});

test('already published → 200 idempotent with the existing url, no upload', async () => {
  const { deps: d, calls } = deps({
    media: { ...READY_VIDEO, external_url: 'https://youtu.be/OLD' },
  });
  const r = await decideMediaPublish(CMD, d);
  assert.equal(r.status, 200);
  assert.equal(r.body.url, 'https://youtu.be/OLD');
  assert.equal(r.body.idempotent, true);
  assert.equal(calls.began, 0);
  assert.equal(calls.published, 0);
});

test('dry-run → 200 dryRun, no audit/idempotency/upload', async () => {
  const { deps: d, calls } = deps({ willDryRun: () => true });
  const r = await decideMediaPublish(CMD, d);
  assert.equal(r.status, 200);
  assert.equal(r.body.dryRun, true);
  assert.equal(r.body.published, false);
  assert.equal(calls.began, 0);
  assert.equal(calls.published, 0);
  assert.equal(calls.recorded.length, 0);
});

test('success → fetch + upload + record + complete, returns the watch url', async () => {
  const { deps: d, calls } = deps({});
  const r = await decideMediaPublish(CMD, d);
  assert.equal(r.status, 200);
  assert.equal(r.body.published, true);
  assert.equal(r.body.url, 'https://youtu.be/YT123');
  assert.equal(r.body.videoId, 'YT123');
  assert.equal(calls.began, 1);
  assert.equal(calls.fetched, 1);
  assert.equal(calls.published, 1);
  assert.equal(calls.completed, 1);
  assert.equal(calls.deleted, 0);
  assert.deepEqual(calls.recorded, [
    { url: 'https://youtu.be/YT123', videoId: 'YT123', publishedBy: 'alice' },
  ]);
});

test('completed marker → 200 idempotent, no re-upload', async () => {
  const { deps: d, calls } = deps({ acquire: { kind: 'completed' } });
  const r = await decideMediaPublish(CMD, d);
  assert.equal(r.status, 200);
  assert.equal(r.body.idempotent, true);
  assert.equal(calls.published, 0);
});

test('in-flight marker → 409, no upload', async () => {
  const { deps: d, calls } = deps({ acquire: { kind: 'in_flight' } });
  const r = await decideMediaPublish(CMD, d);
  assert.equal(r.status, 409);
  assert.equal(r.body.inFlight, true);
  assert.equal(calls.published, 0);
});

test('upload failure → 502 and the dedupe marker is cleared for retry', async () => {
  const { deps: d, calls } = deps({
    publish: async () => {
      throw new Error('youtube 500');
    },
  });
  const r = await decideMediaPublish(CMD, d);
  assert.equal(r.status, 502);
  assert.equal(calls.deleted, 1);
  assert.equal(calls.completed, 0);
  assert.equal(calls.recorded.length, 0);
});
