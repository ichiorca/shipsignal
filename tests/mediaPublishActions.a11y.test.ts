// AC: the publish-to-YouTube action is WCAG 2.2 AA — labelled reviewer field + a real button in
// the publish state, and a real link in the already-published state. Renders the real component to
// static markup, runs axe in jsdom.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import axe from 'axe-core';
import { MediaPublishActions } from '../app/components/MediaPublishActions.ts';

const MEDIA_ID = 'aaaaaaaa-1111-2222-3333-444444444444';

function render(publishedUrl: string | null): Document {
  const html = renderToStaticMarkup(
    createElement(
      'main',
      { id: 'main' },
      createElement(MediaPublishActions, { mediaId: MEDIA_ID, publishedUrl }),
    ),
  );
  return new JSDOM(`<!doctype html><html lang="en"><body>${html}</body></html>`).window.document;
}

test('publish action has zero axe violations (unpublished and published)', async () => {
  for (const url of [null, 'https://youtu.be/YT123']) {
    const results = await axe.run(render(url).body, {
      rules: { 'color-contrast': { enabled: false } },
    });
    assert.deepEqual(
      results.violations.map((v) => v.id),
      [],
    );
  }
});

test('unpublished state: labelled reviewer field + a publish button', () => {
  const doc = render(null);
  const id = `publish-reviewer-${MEDIA_ID}`;
  assert.ok(doc.querySelector(`#${id}`), 'reviewer input exists');
  assert.ok(doc.querySelector(`label[for="${id}"]`), 'label for the reviewer input exists');
  const button = doc.querySelector(`[data-youtube-publish="${MEDIA_ID}"] button`);
  assert.ok(button, 'a publish button exists');
});

test('published state: renders the watch link, no form', () => {
  const doc = render('https://youtu.be/YT123');
  const link = doc.querySelector(`[data-youtube-published="${MEDIA_ID}"] a`);
  assert.ok(link, 'a link to the published video exists');
  assert.equal(link?.getAttribute('href'), 'https://youtu.be/YT123');
  assert.ok(!doc.querySelector(`[data-youtube-publish="${MEDIA_ID}"]`), 'no publish form when published');
});
