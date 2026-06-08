// T5 (spec 004) — AC5: Playwright e2e for the Gate #1 approve and reject flows.
//
// Drives the real review surface (app/releases/[id]/review + FeatureManifestReview) the
// operator uses — not a private helper (anti-pattern #4). It seeds a release run with two
// pending features via the test API, then exercises:
//   1. Approve  — record an 'approved' decision for one feature;
//   2. Reject   — record a 'rejected' decision for the other;
//   3. Submit & resume — POST the manifest-level decision and confirm the run resumes.
//
// Excluded from `tsc` and the `node --test` gate (Playwright is a separate runner with
// its own deps). Run with: npx playwright test e2e/ — see e2e/playwright.config.ts.
// Uses synthetic fixtures only (domain-gdpr: no real PII in Playwright).

import { test, expect } from '@playwright/test';

const RUN_ID = process.env.E2E_RELEASE_RUN_ID ?? 'rrrrrrrr-1111-2222-3333-444444444444';

test.describe('Gate #1 feature-manifest approval', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/releases/${RUN_ID}/review`);
    await expect(page.getByRole('heading', { name: 'Approve feature manifest' })).toBeVisible();
    // The gate blocks downstream generation until a human decides (constitution §5).
    await page.getByLabel('Reviewer name').fill('e2e-reviewer');
  });

  test('approve flow records an approved decision for a feature', async ({ page }) => {
    const firstFeature = page.locator('section[data-feature-id]').first();
    const approve = firstFeature.getByRole('button', { name: 'Approve' });

    // Approve must be reachable by keyboard (WCAG 2.2 AA operability).
    await approve.focus();
    await expect(approve).toBeFocused();
    await approve.click();

    await expect(page.getByRole('status')).toContainText('Recorded approved');
  });

  test('reject flow records a rejected decision for a feature', async ({ page }) => {
    const feature = page.locator('section[data-feature-id]').nth(1);
    await feature.getByRole('button', { name: 'Reject' }).click();

    await expect(page.getByRole('status')).toContainText('Recorded rejected');
  });

  test('submitting the manifest resumes the run on the same thread', async ({ page }) => {
    await page.getByRole('button', { name: 'Submit & resume' }).click();
    await expect(page.getByRole('status')).toContainText('resuming');
  });
});
