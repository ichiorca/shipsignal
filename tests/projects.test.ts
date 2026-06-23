// Unit tests for the pure Projects domain layer (slug, input validation, secret-free view).
// No DB / no network — mirrors releaseInput.test.ts.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  slugifyProjectId,
  parseProjectInput,
  projectToView,
  type Project,
} from '../app/lib/projects.ts';

test('slugifyProjectId derives a stable proj_ slug', () => {
  assert.equal(slugifyProjectId('Acme Launchpad'), 'proj_acme_launchpad');
  assert.equal(slugifyProjectId('  Weird---Name!! '), 'proj_weird_name');
  assert.equal(slugifyProjectId(''), 'proj_unnamed');
});

test('parseProjectInput accepts a valid project and defaults optional fields', () => {
  const parsed = parseProjectInput({ name: 'Acme', repos: ['acme/web', 'acme/api'] });
  assert.ok(parsed.ok);
  assert.equal(parsed.value.name, 'Acme');
  assert.deepEqual(parsed.value.repos, ['acme/web', 'acme/api']);
  assert.equal(parsed.value.default_base_ref, ''); // blank default allowed
  assert.equal(parsed.value.status, 'active');
});

test('parseProjectInput rejects a bad repo slug', () => {
  const parsed = parseProjectInput({ name: 'Acme', repos: ['not-a-slug'] });
  assert.ok(!parsed.ok);
  assert.ok(parsed.errors.some((e) => e.includes('owner/repo')));
});

test('parseProjectInput rejects duplicate repos and an empty name', () => {
  const dup = parseProjectInput({ name: 'Acme', repos: ['a/b', 'a/b'] });
  assert.ok(!dup.ok);
  assert.ok(dup.errors.some((e) => e.includes('repeat')));

  const noName = parseProjectInput({ name: '   ', repos: [] });
  assert.ok(!noName.ok);
});

test('parseProjectInput rejects unknown keys (strict)', () => {
  const parsed = parseProjectInput({ name: 'Acme', repos: [], sneaky: true });
  assert.ok(!parsed.ok);
});

test('projectToView collapses the secret reference to has_secret (never leaks token/ARN)', () => {
  const base: Project = {
    id: 'proj_acme',
    tenant_id: 'default',
    name: 'Acme',
    default_base_ref: 'main',
    default_head_ref: 'release',
    github_secret_id: 'arn:aws:secretsmanager:us-east-1:123:secret:shipsignal/github/acme',
    status: 'active',
    repos: ['acme/web'],
  };
  const withSecret = projectToView(base);
  assert.equal(withSecret.has_secret, true);
  assert.ok(!('github_secret_id' in withSecret)); // the reference must not reach the client
  assert.equal(projectToView({ ...base, github_secret_id: null }).has_secret, false);
  assert.equal(projectToView({ ...base, github_secret_id: '' }).has_secret, false);
});
