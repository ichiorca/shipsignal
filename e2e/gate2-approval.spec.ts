// T5 (spec 006) / T4 (spec 007) — AC: Playwright e2e for the Gate #2 artifact-review flow,
// including a blocked-claim case and the spec-007 multi-artifact (grouped-by-type) review.
//
// Drives the real review surface (app/releases/[id]/artifacts/review + ArtifactReview) the
// operator uses — not a private helper (anti-pattern #4). It expects a seeded run with two
// artifacts: one clean (all claims supported) and one BLOCKED by a check (e.g. an unsupported
// fabricated-metric claim). It exercises:
//   1. Approve  — record an 'approved' decision for the clean artifact;
//   2. Blocked  — the blocked artifact is announced and its Approve button is disabled
//                 (an unsupported/high-risk claim cannot reach an approved state);
//   3. Reject   — record a 'rejected' decision for the blocked artifact;
//   4. Submit & resume — POST the run-level decision and confirm the run resumes.
//
// Excluded from `tsc` and the `node --test` gate (Playwright is a separate runner with its own
// deps). Run with: npx playwright test e2e/ — see e2e/playwright.config.ts.
// Uses synthetic fixtures only (domain-gdpr: no real PII in Playwright).

import { test, expect } from '@playwright/test';

const RUN_ID = process.env.E2E_RELEASE_RUN_ID ?? 'rrrrrrrr-1111-2222-3333-444444444444';

test.describe('Gate #2 artifact approval', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/releases/${RUN_ID}/artifacts/review`);
    await expect(
      page.getByRole('heading', { name: 'Review artifacts (Gate #2)' }),
    ).toBeVisible();
    // The gate blocks publishing until a human decides (constitution §5).
    await page.getByLabel('Reviewer name').fill('e2e-reviewer');
  });

  test('approve flow records an approved decision for a clean artifact', async ({ page }) => {
    // The first non-blocked artifact section's Approve must be enabled + keyboard-operable.
    const clean = page.locator('section[data-artifact-status="draft"]').first();
    const approve = clean.getByRole('button', { name: 'Approve' });

    await approve.focus();
    await expect(approve).toBeFocused();
    await expect(approve).toBeEnabled();
    await approve.click();

    await expect(page.getByRole('status')).toContainText('Recorded approved');
  });

  test('a blocked artifact announces the block and disables Approve', async ({ page }) => {
    const blocked = page.locator('section[data-artifact-status="blocked"]').first();
    await expect(blocked).toBeVisible();
    // The blocking reason is announced (WCAG: not colour alone), and approval is refused.
    await expect(blocked.getByRole('alert')).toBeVisible();
    await expect(blocked.getByRole('button', { name: 'Approve' })).toBeDisabled();
    // Its unsupported claim is shown as text.
    await expect(blocked.locator('dd[data-support="unsupported"]')).toContainText('unsupported');
  });

  test('reject flow records a rejected decision for the blocked artifact', async ({ page }) => {
    const blocked = page.locator('section[data-artifact-status="blocked"]').first();
    await blocked.getByRole('button', { name: 'Reject' }).click();

    await expect(page.getByRole('status')).toContainText('Recorded rejected');
  });

  test('submitting the review resumes the run on the same thread', async ({ page }) => {
    await page.getByRole('button', { name: 'Submit & resume' }).click();
    await expect(page.getByRole('status')).toContainText('resuming');
  });

  // T4 (spec 007) — the expanded artifact set is presented grouped by type, each group a
  // labelled section with a heading, so a reviewer can scan blog/sales/demo/etc. by type.
  test('artifacts are grouped into a labelled section per artifact type', async ({ page }) => {
    const groups = page.locator('section[data-artifact-type-group]');
    await expect(groups.first()).toBeVisible();
    const count = await groups.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i += 1) {
      const group = groups.nth(i);
      // The group is named by an <h2> heading (WCAG: a region must have an accessible name).
      await expect(group.getByRole('heading', { level: 2 }).first()).toBeVisible();
      // Each group holds at least one artifact subsection.
      await expect(group.locator('section[data-artifact-id]').first()).toBeVisible();
    }
  });
});
