// Path B / Phase 1 — Playwright e2e for the job-based IA reskin: the primary nav now groups the
// product into the four jobs (Author / Distribute / Measure / Admin) instead of the old
// Runs/Skills/Trends/Webhooks/Settings list, the home leads with "Launches", and Distribute exposes
// the Phase-3/4 channel-status + scheduled-posts surfaces.
//
// Drives the real shell + section hubs (no seed required — pages render their empty states on an
// empty DB). Excluded from tsc/node --test (Playwright is a separate runner). Run with:
//   npx playwright test --config e2e/playwright.config.ts

import { test, expect } from '@playwright/test';

test.describe('Job-based primary navigation (Path B / Phase 1)', () => {
  test('home leads with Launches and the nav exposes the four jobs', async ({ page }) => {
    await page.goto('/');
    // The reskinned home leads with the product value, not the pipeline ("Release runs" → "Launches").
    await expect(page.getByRole('heading', { level: 1, name: 'Launches' })).toBeVisible();

    const nav = page.getByRole('navigation', { name: 'Primary' });
    for (const label of ['Author', 'Distribute', 'Measure', 'Admin']) {
      await expect(nav.getByRole('link', { name: label })).toBeVisible();
    }
    // The old engineer-facing tabs are gone from the top nav.
    await expect(nav.getByRole('link', { name: 'Runs', exact: true })).toHaveCount(0);
  });

  test('Distribute hub shows channel status and the scheduled-posts queue', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Distribute' }).click();

    await expect(page.getByRole('heading', { level: 1, name: 'Distribute' })).toBeVisible();
    // Phase 3 — per-channel connection status (env-driven; dry-run when unconfigured).
    await expect(page.locator('[data-channel-status]')).toBeVisible();
    await expect(page.locator('[data-channel="linkedin"]')).toBeVisible();
    await expect(page.locator('[data-channel="x"]')).toBeVisible();
    // Phase 4 — the scheduled-posts queue (the section heading is unique on the page).
    await expect(page.getByRole('heading', { name: 'Scheduled posts' })).toBeVisible();
  });

  test('Measure and Admin hubs render their landings', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Measure' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Measure' })).toBeVisible();

    await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Admin' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Admin' })).toBeVisible();
    // Admin groups the configuration surfaces (brand voice, connections, skills).
    await expect(page.getByRole('link', { name: 'Brand voice & audience' })).toBeVisible();
  });
});
