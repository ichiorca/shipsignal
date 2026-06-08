// T3 (spec 012) — AC: full-loop Playwright e2e tying the whole reproducible loop together
// across all three human gates on synthetic data (constitution §8 Definition of Done).
//
// The per-gate specs (gate1/gate2/gate3-approval.spec.ts) exercise each gate's mechanics in
// isolation. THIS spec is the end-to-end integration walk the DoD requires: it drives the
// SAME release run through the real operator surfaces in order —
//
//   release review (run detail)
//     → Gate #1 feature-manifest approval + resume
//       → Gate #2 artifact review (incl. a blocked unsupported-claim artifact) + resume
//         → Gate #3 skill-candidate approval + resume
//
// and asserts each gate resumes on the SAME run (PRD §5.6 "resume the same thread_id" — the
// resume dispatch keys off release_run_id + the per-phase thread). It uses synthetic fixtures
// only (domain-gdpr: no real PII in Playwright), and asserts NO gate is auto-satisfied: every
// hop requires a reviewer name + an explicit decision (constitution §5).
//
// Excluded from `tsc` and the `node --test` gate (Playwright is a separate runner with its own
// deps). Run with: npx playwright test e2e/ — see e2e/playwright.config.ts.

import { test, expect } from '@playwright/test';

const RUN_ID = process.env.E2E_RELEASE_RUN_ID ?? 'rrrrrrrr-1111-2222-3333-444444444444';

test.describe('full loop end-to-end across all three gates', () => {
  test('release review → Gate #1 → Gate #2 (with a blocked claim) → Gate #3, same run resumed at each', async ({
    page,
  }) => {
    // --- Release review (run detail) — the loop's entry surface (PRD §13.1). ----------
    await page.goto(`/releases/${RUN_ID}`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Release run');
    // The operator reaches Gate #1 from here, not by guessing a URL.
    await page.getByRole('link', { name: /Review feature manifest \(Gate #1\)/ }).click();

    // --- Gate #1: feature-manifest approval, then resume the SAME run. -----------------
    await expect(
      page.getByRole('heading', { name: 'Approve feature manifest' }),
    ).toBeVisible();
    // No anonymous self-approval (constitution §5): a reviewer name is required.
    await page.getByLabel('Reviewer name').fill('e2e-reviewer');
    await page.locator('section[data-feature-id]').first().getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByRole('status')).toContainText('Recorded approved');
    await page.getByRole('button', { name: 'Submit & resume' }).click();
    await expect(page.getByRole('status')).toContainText('resuming');

    // --- Gate #2: artifact review — clean artifact approves, blocked one cannot. -------
    await page.goto(`/releases/${RUN_ID}/artifacts/review`);
    await expect(
      page.getByRole('heading', { name: 'Review artifacts (Gate #2)' }),
    ).toBeVisible();
    await page.getByLabel('Reviewer name').fill('e2e-reviewer');

    // An unsupported-claim artifact is BLOCKED: its approval is refused and announced
    // (constitution §5: an unsupported/high-risk claim can never reach an approved state).
    const blocked = page.locator('section[data-artifact-status="blocked"]').first();
    await expect(blocked).toBeVisible();
    await expect(blocked.getByRole('alert')).toBeVisible();
    await expect(blocked.getByRole('button', { name: 'Approve' })).toBeDisabled();

    // A clean artifact approves, then we resume the SAME run past Gate #2.
    const clean = page.locator('section[data-artifact-status="draft"]').first();
    await clean.getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByRole('status')).toContainText('Recorded approved');
    await page.getByRole('button', { name: 'Submit & resume' }).click();
    await expect(page.getByRole('status')).toContainText('resuming');

    // --- Gate #3: skill-candidate approval — the worker performs the repo write, not UI.
    await page.goto(`/releases/${RUN_ID}/skills/review`);
    await expect(
      page.getByRole('heading', { name: 'Review skill revisions (Gate #3)' }),
    ).toBeVisible();
    await page.getByLabel('Reviewer name').fill('e2e-reviewer');
    // The candidate shows the current vs proposed SKILL.md diff (PRD §9.5).
    const candidate = page.locator('section[data-skill-candidate]').first();
    await expect(candidate.locator('section[data-panel="current"]')).toBeVisible();
    await expect(candidate.locator('section[data-panel="proposed"]')).toBeVisible();
    await page.getByRole('button', { name: 'Approve and replace repo skill' }).click();
    await expect(page.getByRole('status')).toContainText('approved');
    await expect(page.getByRole('status')).toContainText('resuming');
  });
});
