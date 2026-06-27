// Unit tests for the pure Google OAuth URL/body builders (no network): the consent URL forces a
// refresh token (offline + consent), carries the CSRF state and upload scope, and the token-exchange
// body uses the authorization_code grant.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildConsentUrl,
  buildTokenExchangeBody,
  GOOGLE_AUTH_ENDPOINT,
  YOUTUBE_UPLOAD_SCOPE,
} from '../app/lib/googleOAuth.ts';

test('buildConsentUrl carries client_id, redirect, scope, state, and forces a refresh token', () => {
  const url = buildConsentUrl({
    clientId: 'client-123',
    redirectUri: 'https://app.example.com/api/connections/google/callback',
    state: 'st4te',
  });
  assert.ok(url.startsWith(`${GOOGLE_AUTH_ENDPOINT}?`));
  const q = new URL(url).searchParams;
  assert.equal(q.get('client_id'), 'client-123');
  assert.equal(q.get('redirect_uri'), 'https://app.example.com/api/connections/google/callback');
  assert.equal(q.get('response_type'), 'code');
  assert.equal(q.get('scope'), YOUTUBE_UPLOAD_SCOPE);
  assert.equal(q.get('access_type'), 'offline'); // refresh token
  assert.equal(q.get('prompt'), 'consent'); // re-issue refresh token every connect
  assert.equal(q.get('state'), 'st4te');
});

test('buildTokenExchangeBody uses the authorization_code grant with the matching redirect', () => {
  const body = new URLSearchParams(
    buildTokenExchangeBody({
      clientId: 'client-123',
      clientSecret: 'secret-xyz',
      code: 'auth-code',
      redirectUri: 'https://app.example.com/api/connections/google/callback',
    }),
  );
  assert.equal(body.get('grant_type'), 'authorization_code');
  assert.equal(body.get('code'), 'auth-code');
  assert.equal(body.get('client_id'), 'client-123');
  assert.equal(body.get('client_secret'), 'secret-xyz');
  assert.equal(body.get('redirect_uri'), 'https://app.example.com/api/connections/google/callback');
});
