// Operator feedback 2026-06-09 (priority 1) — unit coverage for the pure publish assembly:
// GitHub Release payloads and Slack announcements are built ONLY from the §18.1 approved
// snapshot, carry the provenance trust line, and the request boundary names an accountable
// reviewer. The authenticated HTTP layer (publishDispatch) is exercised via these payload
// contracts; no network in the unit gate.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGitHubReleasePayload,
  buildSlackAnnouncement,
  isGitHubPublishable,
  publishRequestSchema,
} from '../app/lib/publish.ts';
import type { ApprovedSnapshotView } from '../app/lib/artifactExport.ts';

const SNAPSHOT: ApprovedSnapshotView = {
  artifact_id: 'aaaaaaaa-1111-2222-3333-444444444444',
  release_run_id: 'rrrrrrrr-1111-2222-3333-444444444444',
  approval_id: 'apvapvap-1111-2222-3333-444444444444',
  artifact_type: 'changelog_entry',
  model_id: 'bedrock-model-x',
  prompt_version: 'v3',
  skill_versions: { 'changelog-format': '1.0.0' },
  evidence_ids: ['e1111111-1111-2222-3333-444444444444'],
  claim_support: [
    { claim_id: 'c1', support_status: 'supported', risk_level: 'low' },
    { claim_id: 'c2', support_status: 'supported', risk_level: 'low' },
  ],
  reviewer_decision: 'approved',
  final_title: 'Checklists ship',
  final_body_markdown: 'Admins can now create reusable onboarding checklists.',
  content_hash: 'abc123def456abc123def456',
  generated_at: '2026-06-01T00:00:00.000Z',
  approved_at: '2026-06-02T00:00:00.000Z',
};

test('the GitHub Release is keyed to the tag, titled, and bodied with the trust footer', () => {
  const payload = buildGitHubReleasePayload(SNAPSHOT, 'v1.13.0');
  assert.equal(payload.tag_name, 'v1.13.0');
  assert.equal(payload.name, 'Checklists ship');
  assert.ok(payload.body.includes('Admins can now create reusable onboarding checklists.'));
  // The published release proves its own evidence-linking (trust badge travels with it).
  assert.ok(payload.body.includes('**Provenance:** 2/2 claims evidence-linked (100%)'));
});

test('a null title falls back to a tag-derived release name', () => {
  const payload = buildGitHubReleasePayload({ ...SNAPSHOT, final_title: null }, 'v2.0.0');
  assert.equal(payload.name, 'Release v2.0.0');
});

test('only changelog/blog types are GitHub-publishable', () => {
  assert.ok(isGitHubPublishable('changelog_entry'));
  assert.ok(isGitHubPublishable('release_blog'));
  assert.ok(!isGitHubPublishable('sales_onepager'));
  assert.ok(!isGitHubPublishable('demo_script'));
});

test('the Slack announcement carries title, body, provenance line, and dashboard link', () => {
  const { text } = buildSlackAnnouncement(SNAPSHOT, 'https://dash.example.com/');
  assert.ok(text.startsWith('*Checklists ship*'));
  assert.ok(text.includes('Admins can now create reusable onboarding checklists.'));
  assert.ok(text.includes('2/2 claims evidence-linked.'));
  assert.ok(text.includes('Human-approved at Gate #2'));
  // The trailing slash on the base URL is normalized; the link targets the run's artifacts.
  assert.ok(
    text.includes(
      `<https://dash.example.com/releases/${SNAPSHOT.release_run_id}/artifacts|`,
    ),
  );
});

test('the Slack announcement omits the link when no dashboard URL is configured', () => {
  const { text } = buildSlackAnnouncement(SNAPSHOT, null);
  assert.ok(!text.includes('<http'));
});

test('a long body is excerpted word-safely with an ellipsis', () => {
  const long = { ...SNAPSHOT, final_body_markdown: 'word '.repeat(600).trim() };
  const { text } = buildSlackAnnouncement(long, null);
  assert.ok(text.includes('…'));
  assert.ok(text.length < long.final_body_markdown.length);
  assert.ok(!text.includes('wor …'), 'cuts at a word boundary, not mid-word');
});

test('no publish payload carries a reviewer identity', () => {
  const release = buildGitHubReleasePayload(SNAPSHOT, 'v1.0.0');
  const slack = buildSlackAnnouncement(SNAPSHOT, 'https://dash.example.com');
  assert.ok(!JSON.stringify(release).includes('reviewer'));
  assert.ok(!slack.text.includes('reviewer'));
});

test('the publish request boundary requires a named reviewer', () => {
  assert.equal(publishRequestSchema.safeParse({ reviewer: 'pm@example.com' }).success, true);
  assert.equal(publishRequestSchema.safeParse({ reviewer: '' }).success, false);
  assert.equal(publishRequestSchema.safeParse({}).success, false);
  assert.equal(
    publishRequestSchema.safeParse({ reviewer: 'x', extra: true }).success,
    false,
    'unknown keys are rejected (strict boundary)',
  );
});
