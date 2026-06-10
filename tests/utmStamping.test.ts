// T2 (spec 021) — unit coverage for the pure export-time UTM stamper. The load-bearing
// assertions from the spec AC: deterministic (same input → same output), IDEMPOTENT
// (stamping a stamped document converges), absolute http(s) link targets ONLY (relative/
// mailto/anchor targets, link text, inline code, and fenced code untouched), and existing
// non-utm query params + fragments survive in place.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stampMarkdownLinks, stampUrl } from '../app/lib/utmStamping.ts';

const PARAMS = {
  artifact_type: 'release_blog',
  release_run_id: 'rrrrrrrr-1111-2222-3333-444444444444',
} as const;

const STAMP =
  'utm_source=shipsignal&utm_medium=release_blog&' +
  'utm_campaign=rrrrrrrr-1111-2222-3333-444444444444';

test('a bare absolute link gains exactly the three deterministic params', () => {
  assert.equal(stampUrl('https://example.com/docs', PARAMS), `https://example.com/docs?${STAMP}`);
});

test('existing query params and fragment survive in place', () => {
  assert.equal(
    stampUrl('https://example.com/docs?page=2#install', PARAMS),
    `https://example.com/docs?page=2&${STAMP}#install`,
  );
});

test('stamping is idempotent: stale utm values are replaced, not appended', () => {
  const once = stampUrl('https://example.com/?utm_source=other&x=1', PARAMS);
  assert.equal(once, `https://example.com/?x=1&${STAMP}`);
  assert.equal(stampUrl(once, PARAMS), once);
});

test('markdown stamping is deterministic and idempotent end to end', () => {
  const doc = 'See [docs](https://example.com/docs) and [more](https://example.com/more?a=1).';
  const once = stampMarkdownLinks(doc, PARAMS);
  assert.equal(once, stampMarkdownLinks(doc, PARAMS));
  assert.equal(stampMarkdownLinks(once, PARAMS), once);
});

test('only absolute http(s) targets are stamped; others pass through untouched', () => {
  const doc = [
    '[rel](/docs/install)',
    '[anchor](#setup)',
    '[mail](mailto:team@example.com)',
    '[evil](javascript:alert(1))',
    '[abs](https://example.com/x)',
    '[abs-http](http://example.com/y)',
  ].join('\n');
  const stamped = stampMarkdownLinks(doc, PARAMS);
  assert.ok(stamped.includes('[rel](/docs/install)'));
  assert.ok(stamped.includes('[anchor](#setup)'));
  assert.ok(stamped.includes('[mail](mailto:team@example.com)'));
  assert.ok(stamped.includes('[evil](javascript:alert(1))'));
  assert.ok(stamped.includes(`[abs](https://example.com/x?${STAMP})`));
  assert.ok(stamped.includes(`[abs-http](http://example.com/y?${STAMP})`));
});

test('link text and non-link prose are byte-identical', () => {
  const doc = 'Visit [our https://decoy.example docs](https://example.com/docs) today: https://bare.example/url stays.';
  const stamped = stampMarkdownLinks(doc, PARAMS);
  // Link text (even when it looks like a URL) is untouched; bare non-link URLs are not links.
  assert.ok(stamped.includes('[our https://decoy.example docs]'));
  assert.ok(stamped.includes('https://bare.example/url stays.'));
});

test('fenced code blocks and inline code spans are never stamped', () => {
  const doc = [
    'Real [link](https://example.com/a).',
    '```',
    '[in-fence](https://example.com/b)',
    '```',
    'Inline `[in-code](https://example.com/c)` span.',
  ].join('\n');
  const stamped = stampMarkdownLinks(doc, PARAMS);
  assert.ok(stamped.includes(`[link](https://example.com/a?${STAMP})`));
  assert.ok(stamped.includes('[in-fence](https://example.com/b)\n'));
  assert.ok(stamped.includes('`[in-code](https://example.com/c)`'));
});

test('an unclosed fence runs to the end without stamping (mirrors the renderer)', () => {
  const doc = '```\n[never](https://example.com/x)\n';
  assert.equal(stampMarkdownLinks(doc, PARAMS), doc);
});

test('a document with no absolute links is returned byte-identical', () => {
  const doc = '# Title\n\nPlain prose with [rel](/a) and `code`.\n';
  assert.equal(stampMarkdownLinks(doc, PARAMS), doc);
});
