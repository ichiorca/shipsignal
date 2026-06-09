// T1/T5 (spec 019) — unit coverage for the pure export assembly over the §18.1 approved
// snapshot. The load-bearing assertions: the JSON record carries the full provenance set from
// the spec AC, NO export shape carries the reviewer's name (data minimization), and rendering
// is driven solely by the snapshot (the publishable truth) — there is no path that accepts the
// mutable artifact row.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildExportRecord,
  exportFilename,
  isExportFormat,
  renderExport,
  renderHtmlExport,
  renderMarkdownExport,
  type ApprovedSnapshotView,
} from '../app/lib/artifactExport.ts';

const SNAPSHOT: ApprovedSnapshotView = {
  artifact_id: 'aaaaaaaa-1111-2222-3333-444444444444',
  release_run_id: 'rrrrrrrr-1111-2222-3333-444444444444',
  approval_id: 'apvapvap-1111-2222-3333-444444444444',
  artifact_type: 'release_blog',
  model_id: 'bedrock-model-x',
  prompt_version: 'v3',
  skill_versions: { 'blog-format': '2.0.0' },
  evidence_ids: ['e1111111-1111-2222-3333-444444444444'],
  claim_support: [
    { claim_id: 'c1111111-1111-2222-3333-444444444444', support_status: 'supported', risk_level: 'low' },
  ],
  reviewer_decision: 'approved',
  final_title: 'Checklists ship',
  final_body_markdown: 'Admins can now create [checklists](https://example.com/docs).',
  content_hash: 'abc123',
  generated_at: '2026-06-01T00:00:00.000Z',
  approved_at: '2026-06-02T00:00:00.000Z',
};

test('the JSON record carries the full provenance set from the AC', () => {
  const record = buildExportRecord(SNAPSHOT);
  assert.equal(record.content_hash, 'abc123');
  assert.deepEqual(record.evidence_ids, SNAPSHOT.evidence_ids);
  assert.deepEqual(record.claim_support, SNAPSHOT.claim_support);
  assert.equal(record.model_id, 'bedrock-model-x');
  assert.equal(record.prompt_version, 'v3');
  assert.deepEqual(record.skill_versions, { 'blog-format': '2.0.0' });
  assert.equal(record.approval_id, SNAPSHOT.approval_id);
  assert.equal(record.reviewer_decision, 'approved');
});

test('no export shape carries a reviewer name field', () => {
  for (const format of ['markdown', 'html', 'json'] as const) {
    const rendered = renderExport(SNAPSHOT, format);
    assert.ok(!rendered.includes('"reviewer"'), `${format} export must not have a reviewer key`);
  }
  assert.ok(!('reviewer' in buildExportRecord(SNAPSHOT)));
});

test('markdown export prepends the approved title as an H1', () => {
  assert.ok(renderMarkdownExport(SNAPSHOT).startsWith('# Checklists ship\n\n'));
});

test('markdown export does not double an existing leading H1', () => {
  const led = { ...SNAPSHOT, final_body_markdown: '# Checklists ship\n\nBody.' };
  assert.equal(renderMarkdownExport(led), led.final_body_markdown);
});

test('markdown export with a null title is the body verbatim', () => {
  const untitled = { ...SNAPSHOT, final_title: null };
  assert.equal(renderMarkdownExport(untitled), untitled.final_body_markdown);
});

test('html export is a standalone document carrying the content hash and run id', () => {
  const html = renderHtmlExport(SNAPSHOT);
  assert.ok(html.startsWith('<!doctype html>'));
  assert.ok(html.includes('shipsignal-content-hash" content="abc123"'));
  assert.ok(html.includes(`shipsignal-release-run" content="${SNAPSHOT.release_run_id}"`));
  assert.ok(html.includes('<a href="https://example.com/docs">checklists</a>'));
});

test('html export escapes a hostile title', () => {
  const hostile = { ...SNAPSHOT, final_title: '<script>x</script>' };
  const html = renderHtmlExport(hostile);
  assert.ok(!html.includes('<script>x'));
  assert.ok(html.includes('&lt;script&gt;'));
});

test('json export round-trips through JSON.parse to the record', () => {
  const parsed: unknown = JSON.parse(renderExport(SNAPSHOT, 'json'));
  assert.deepEqual(parsed, buildExportRecord(SNAPSHOT));
});

test('format validation accepts exactly the three formats', () => {
  assert.ok(isExportFormat('markdown'));
  assert.ok(isExportFormat('html'));
  assert.ok(isExportFormat('json'));
  assert.ok(!isExportFormat('pdf'));
  assert.ok(!isExportFormat(''));
});

test('filenames are deterministic, extension per format', () => {
  assert.equal(exportFilename(SNAPSHOT, 'markdown'), 'release_blog-aaaaaaaa.md');
  assert.equal(exportFilename(SNAPSHOT, 'html'), 'release_blog-aaaaaaaa.html');
  assert.equal(exportFilename(SNAPSHOT, 'json'), 'release_blog-aaaaaaaa.json');
});
