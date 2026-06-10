// T3/T4 (spec 021) — unit coverage for the engagement ingestion boundary: the strict JSON
// batch schema, the CSV parser with row-level errors, the cross-run scoping gate, and the
// CSV template round-trip. The load-bearing assertions from the spec AC: a row with an
// UNEXPECTED field (anything user-level: user_id, email, ...) is rejected, malformed CSV
// rows are reported per line, and nothing user-level can pass the boundary at all.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CSV_HEADER,
  buildCsvTemplate,
  engagementBatchSchema,
  engagementRowSchema,
  findForeignArtifactRows,
  parseEngagementCsv,
} from '../app/lib/engagementIngest.ts';
import { parseBody } from '../app/lib/featureReview.ts';

const ARTIFACT_ID = 'aaaaaaaa-1111-2222-3333-444444444444';
const GOOD_ROW = {
  artifact_id: ARTIFACT_ID,
  metric: 'views',
  value: 1200,
  as_of: '2026-06-08',
} as const;

test('a valid batch parses', () => {
  const parsed = parseBody(engagementBatchSchema, { rows: [GOOD_ROW] });
  assert.ok(parsed.ok);
  assert.equal(parsed.ok && parsed.value.rows[0]?.value, 1200);
});

test('rows with unexpected fields are rejected — user-level data cannot ride in', () => {
  // The spec's no-PII AC: strict schemas refuse anything beyond the aggregate shape.
  for (const smuggled of [
    { ...GOOD_ROW, user_id: 'u-123' },
    { ...GOOD_ROW, email: 'person@example.com' },
    { ...GOOD_ROW, ip_address: '203.0.113.7' },
    { ...GOOD_ROW, session_id: 'abc' },
  ]) {
    const parsed = parseBody(engagementBatchSchema, { rows: [smuggled] });
    assert.ok(!parsed.ok, `field ${Object.keys(smuggled).at(-1)} must be rejected`);
  }
  // The batch envelope is closed too.
  const extraTop = parseBody(engagementBatchSchema, { rows: [GOOD_ROW], source: 'api' });
  assert.ok(!extraTop.ok, 'source is server-derived and must not be client-supplied');
});

test('invalid values are rejected with user-safe messages', () => {
  const cases = [
    { ...GOOD_ROW, value: -1 },
    { ...GOOD_ROW, value: 1.5 },
    { ...GOOD_ROW, metric: 'user_sessions' },
    { ...GOOD_ROW, artifact_id: 'not-a-uuid' },
    { ...GOOD_ROW, as_of: '2026-02-31' }, // not a real calendar date
    { ...GOOD_ROW, as_of: '08/06/2026' },
  ];
  for (const bad of cases) {
    assert.ok(!engagementRowSchema.safeParse(bad).success);
  }
  // An empty batch is not an ingest.
  assert.ok(!engagementBatchSchema.safeParse({ rows: [] }).success);
});

test('CSV happy path: header + rows, tolerating CRLF, BOM, and blank lines', () => {
  const csv =
    `﻿${CSV_HEADER}\r\n` +
    `${ARTIFACT_ID},views,1200,2026-06-08\r\n` +
    '\r\n' +
    `${ARTIFACT_ID},clicks,40,2026-06-08\r\n`;
  const parsed = parseEngagementCsv(csv);
  assert.ok(parsed.ok);
  assert.equal(parsed.ok && parsed.rows.length, 2);
  assert.deepEqual(parsed.ok && parsed.rows[0], {
    artifact_id: ARTIFACT_ID,
    metric: 'views',
    value: 1200,
    as_of: '2026-06-08',
  });
});

test('malformed CSV rows are reported per line; nothing is partially accepted', () => {
  const csv = [
    CSV_HEADER,
    `${ARTIFACT_ID},views,1200,2026-06-08`, // fine
    `${ARTIFACT_ID},views,-5,2026-06-08`, // negative
    `${ARTIFACT_ID},sessions,3,2026-06-08`, // unknown metric
    'too,few', // wrong arity
  ].join('\n');
  const parsed = parseEngagementCsv(csv);
  assert.ok(!parsed.ok);
  const errors = parsed.ok ? [] : parsed.errors;
  assert.equal(errors.length, 3);
  assert.match(errors[0] ?? '', /^line 3: /);
  assert.match(errors[1] ?? '', /^line 4: /);
  assert.match(errors[2] ?? '', /^line 5: .*4 comma-separated fields/);
});

test('a wrong header and an empty file are rejected up front', () => {
  const wrongHeader = parseEngagementCsv('artifact,metric,value,date\nx,y,1,2026-06-08');
  assert.ok(!wrongHeader.ok);
  assert.match((!wrongHeader.ok && wrongHeader.errors[0]) || '', /header must be exactly/);

  const headerOnly = parseEngagementCsv(`${CSV_HEADER}\n`);
  assert.ok(!headerOnly.ok);
  assert.match((!headerOnly.ok && headerOnly.errors[0]) || '', /no data rows/);
});

test('cross-run artifact ids are rejected with row-numbered, id-free errors', () => {
  const rows = [
    GOOD_ROW,
    { ...GOOD_ROW, artifact_id: 'bbbbbbbb-1111-2222-3333-444444444444' },
  ];
  const errors = findForeignArtifactRows(rows, new Set([ARTIFACT_ID]));
  assert.equal(errors.length, 1);
  assert.equal(errors[0], 'row 2: artifact does not belong to this release run');
  assert.deepEqual(findForeignArtifactRows([GOOD_ROW], new Set([ARTIFACT_ID])), []);
});

test('the downloadable template round-trips through the parser', () => {
  const template = buildCsvTemplate(
    [
      { id: ARTIFACT_ID, artifact_type: 'release_blog' },
      { id: 'bbbbbbbb-1111-2222-3333-444444444444', artifact_type: 'changelog' },
    ],
    '2026-06-09',
  );
  const parsed = parseEngagementCsv(template);
  assert.ok(parsed.ok);
  // One line per (artifact × metric): 2 artifacts × 3 metrics.
  assert.equal(parsed.ok && parsed.rows.length, 6);
});
