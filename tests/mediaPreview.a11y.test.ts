// T6 (spec 008) — AC: the demo-media preview is WCAG 2.2 AA with accessible player controls.
// Renders the real MediaPreview (the same component the media page composes) to static markup,
// runs axe over it in jsdom, and asserts: zero axe violations, each asset is a headed <section>,
// the player is a NATIVE keyboard-operable control (<video>/<audio> with `controls`) carrying an
// accessible name, the media <source> points at the presigned-URL playback route (NOT a raw S3
// URL — the AC: media reaches the client only via presigned URL), a text-alternative transcript
// link to the source demo_script is present, and provenance is exposed as text. constitution §5:
// the component is typed against MediaAsset (key + provenance only), so no raw text is rendered.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import axe from 'axe-core';
import { MediaPreview } from '../app/components/MediaPreview.ts';
import type { MediaAsset } from '../app/lib/db/mediaAssets.ts';

const RUN_ID = 'rrrrrrrr-1111-2222-3333-444444444444';

const ASSETS: readonly MediaAsset[] = [
  {
    id: 'aaaaaaaa-1111-2222-3333-444444444444',
    release_run_id: RUN_ID,
    feature_id: 'ffffffff-1111-2222-3333-444444444444',
    source_artifact_id: 'dddddddd-1111-2222-3333-444444444444',
    media_type: 'demo_video',
    content_type: 'video/mp4',
    duration_seconds: 18,
    status: 'ready',
    provenance: {
      source_artifact_id: 'dddddddd-1111-2222-3333-444444444444',
      clickpath_hash: 'abc123',
      narration_content_hash: 'def456',
      voice_id: 'voice-abc',
    },
    created_at: '2026-06-08T10:00:00.000Z',
  },
  {
    id: 'bbbbbbbb-1111-2222-3333-444444444444',
    release_run_id: RUN_ID,
    feature_id: null,
    source_artifact_id: null,
    media_type: 'release_audio_digest',
    content_type: 'audio/mpeg',
    duration_seconds: null,
    status: 'ready',
    provenance: {},
    created_at: '2026-06-08T10:01:00.000Z',
  },
];

function render(assets: readonly MediaAsset[]): { doc: Document } {
  const html = renderToStaticMarkup(
    createElement(
      'main',
      { id: 'main' },
      createElement('h1', null, 'Demo media'),
      createElement(MediaPreview, { assets }),
    ),
  );
  const doc = new JSDOM(`<!doctype html><html lang="en"><body>${html}</body></html>`)
    .window.document;
  return { doc };
}

async function runAxe(doc: Document) {
  return axe.run(doc.body, { rules: { 'color-contrast': { enabled: false } } });
}

test('populated media preview has zero axe violations', async () => {
  const results = await runAxe(render(ASSETS).doc);
  assert.deepEqual(
    results.violations.map((v) => v.id),
    [],
    `axe violations: ${JSON.stringify(results.violations.map((v) => v.id))}`,
  );
});

test('empty media preview has zero axe violations', async () => {
  const results = await runAxe(render([]).doc);
  assert.deepEqual(results.violations.map((v) => v.id), []);
});

test('each media asset is a headed section with an accessible name', () => {
  const { doc } = render(ASSETS);
  const sections = [...doc.querySelectorAll('section[data-media-id]')];
  assert.equal(sections.length, 2);
  for (const section of sections) {
    const labelledby = section.getAttribute('aria-labelledby');
    assert.ok(labelledby, 'section is labelled by its heading');
    assert.equal(section.querySelector('h2')?.id, labelledby);
  }
});

test('the demo video uses a native keyboard-operable player with an accessible name', () => {
  const { doc } = render(ASSETS);
  const video = doc.querySelector('video[data-media-id]');
  assert.ok(video, 'a <video> element renders for the demo video');
  assert.ok(video?.hasAttribute('controls'), 'native controls are present (keyboard-operable)');
  assert.ok(video?.getAttribute('aria-label'), 'the player has an accessible name');
});

test('the audio digest uses a native <audio> player', () => {
  const { doc } = render(ASSETS);
  const audio = doc.querySelector('audio[data-media-id]');
  assert.ok(audio, 'an <audio> element renders for the audio digest');
  assert.ok(audio?.hasAttribute('controls'), 'native controls are present');
});

test('media is sourced from the presigned-URL playback route, never a raw S3 URL', () => {
  const { doc } = render(ASSETS);
  const sources = [...doc.querySelectorAll('source')];
  assert.equal(sources.length, 2);
  for (const source of sources) {
    const src = source.getAttribute('src') ?? '';
    assert.match(src, /^\/api\/media\/[0-9a-f-]+\/playback$/, 'src is the server playback route');
    assert.ok(!src.includes('s3://') && !src.includes('amazonaws'), 'no raw S3 URL on the client');
  }
});

test('a text-alternative transcript link points at the source demo_script', () => {
  const { doc } = render(ASSETS);
  const videoSection = doc.querySelector('section[data-media-id="aaaaaaaa-1111-2222-3333-444444444444"]');
  const link = videoSection?.querySelector('a[href*="/artifacts/review"]');
  assert.ok(link, 'the video links to its source demo_script as a transcript');
});

test('provenance is exposed as text', () => {
  const { doc } = render(ASSETS);
  const dl = doc.querySelector('dl[data-provenance-for]');
  assert.ok(dl, 'provenance renders as a description list');
  assert.ok(dl?.textContent?.includes('clickpath_hash'), 'a provenance key is shown as text');
});
