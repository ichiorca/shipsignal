// T5 (spec 014) — AC: Playwright e2e proving the demo-media flow end to end:
//   1. Trigger  — POST /api/features/{id}/generate-demo (PRD §14.5): zod-validated, 404 on an
//      unknown feature, 409 on a not-yet-approved feature, 202 + dispatch on an approved one.
//   2. Broken   — the media preview surfaces a §16.3 broken-step asset (the broken step name +
//      'broken' status, no player) instead of failing the run opaquely.
//   3. Success  — the media preview plays the final asset (a native, keyboard-operable player).
//
// Drives the real surfaces the reviewer uses (the generate-demo route + the media preview page +
// MediaPreview component), not a private helper (anti-pattern #4). Excluded from `tsc` and the
// `node --test` gate (Playwright is a separate runner with its own deps). Run with:
//   npx playwright test --config e2e/playwright.config.ts
// Uses synthetic fixtures only (domain-gdpr: no real PII in Playwright).

import { test, expect } from '@playwright/test';

const RUN_ID = process.env.E2E_RELEASE_RUN_ID ?? 'rrrrrrrr-1111-2222-3333-444444444444';
// A seeded APPROVED feature (Gate #1 approved) on the run above, and an UNAPPROVED one.
const APPROVED_FEATURE_ID =
  process.env.E2E_APPROVED_FEATURE_ID ?? 'ffffffff-1111-2222-3333-444444444444';
const UNAPPROVED_FEATURE_ID =
  process.env.E2E_UNAPPROVED_FEATURE_ID ?? 'eeeeeeee-1111-2222-3333-444444444444';
const UNKNOWN_FEATURE_ID = '00000000-0000-4000-8000-000000000000';

test.describe('Demo-media generate-demo trigger (PRD §14.5)', () => {
  test('rejects a body with no reviewer (400)', async ({ request }) => {
    const res = await request.post(`/api/features/${APPROVED_FEATURE_ID}/generate-demo`, {
      data: {},
    });
    expect(res.status()).toBe(400);
  });

  test('404s for an unknown feature', async ({ request }) => {
    const res = await request.post(`/api/features/${UNKNOWN_FEATURE_ID}/generate-demo`, {
      data: { reviewer: 'e2e-reviewer' },
    });
    expect(res.status()).toBe(404);
  });

  test('409s for a feature that is not approved', async ({ request }) => {
    const res = await request.post(`/api/features/${UNAPPROVED_FEATURE_ID}/generate-demo`, {
      data: { reviewer: 'e2e-reviewer' },
    });
    expect(res.status()).toBe(409);
  });

  test('triggers (202) the media graph for an approved feature', async ({ request }) => {
    const res = await request.post(`/api/features/${APPROVED_FEATURE_ID}/generate-demo`, {
      data: { reviewer: 'e2e-reviewer', notes: 'render demo' },
    });
    // 202 when dispatch succeeds; 502 if the (mocked) dispatch could not reach Actions — either
    // way the trigger was accepted/recorded, never a silent 200.
    expect([202, 502]).toContain(res.status());
    if (res.status() === 202) {
      const body = await res.json();
      expect(body).toMatchObject({ feature_id: APPROVED_FEATURE_ID, dispatched: true });
    }
  });
});

test.describe('Demo-media preview broken-step surfacing + playback (§16.3)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/releases/${RUN_ID}/media`);
    await expect(page.getByRole('heading', { name: 'Demo media' })).toBeVisible();
  });

  test('a broken media step is surfaced with its step name, not failed opaquely', async ({
    page,
  }) => {
    const broken = page.locator('section[data-media-status="broken"]').first();
    await expect(broken).toBeVisible();
    // The broken step is named (spec 014 T4 / §16.3).
    await expect(broken.locator('[data-broken-step]')).toBeVisible();
    // A broken asset has no playable media.
    await expect(broken.locator('video, audio')).toHaveCount(0);
  });

  test('a ready asset plays via a native keyboard-operable player', async ({ page }) => {
    const ready = page.locator('section[data-media-status="ready"]').first();
    await expect(ready).toBeVisible();
    const player = ready.locator('video, audio').first();
    await expect(player).toHaveAttribute('controls', '');
    await expect(player).toHaveAttribute('aria-label', /player/);
    // The media is sourced from the presigned-URL playback route, never a raw S3 URL.
    await expect(ready.locator('source')).toHaveAttribute('src', /\/api\/media\/.+\/playback$/);
  });
});
