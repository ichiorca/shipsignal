// T5 (spec 009) — AC5: Playwright e2e for the Gate #3 proposed-skill review flow, covering both
// approve and reject.
//
// Drives the real review surface (app/releases/[id]/skills/review + SkillCandidateReview) the
// operator uses — not a private helper (anti-pattern #4). It expects a seeded run with at least one
// pending (status='draft') skill-revision candidate showing a current vs proposed SKILL.md diff. It
// exercises:
//   1. Diff      — the candidate shows current + proposed SKILL.md panels and supporting signals;
//   2. Approve   — "Approve and replace repo skill" submits the run-level decision and the run
//                  resumes (the WORKER performs the single repo write on the runner, not the UI);
//   3. Reject    — "Reject" submits a rejected decision and the run resumes (the worker records the
//                  rejection + a cooldown suppression).
//
// constitution §1/§5: the UI exposes NO repo-write control — only a resume submission; the repo
// SKILL.md is replaced by the worker, only on an approved Gate #3 decision.
//
// Excluded from `tsc` and the `node --test` gate (Playwright is a separate runner with its own
// deps). Run with: npx playwright test e2e/ — see e2e/playwright.config.ts.
// Uses synthetic fixtures only (domain-gdpr: no real PII in Playwright).

import { test, expect } from '@playwright/test';

const RUN_ID = process.env.E2E_RELEASE_RUN_ID ?? 'rrrrrrrr-1111-2222-3333-444444444444';

test.describe('Gate #3 skill-candidate approval', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/releases/${RUN_ID}/skills/review`);
    await expect(
      page.getByRole('heading', { name: 'Review skill revisions (Gate #3)' }),
    ).toBeVisible();
    // The gate blocks the repo replacement until a human decides (constitution §5).
    await page.getByLabel('Reviewer name').fill('e2e-reviewer');
  });

  test('a candidate shows the current vs proposed SKILL.md diff and supporting signals', async ({
    page,
  }) => {
    const candidate = page.locator('section[data-skill-candidate]').first();
    await expect(candidate).toBeVisible();
    // Both diff panels are present (PRD §9.5 left/right), each a labelled region.
    await expect(candidate.locator('section[data-panel="current"]')).toBeVisible();
    await expect(candidate.locator('section[data-panel="proposed"]')).toBeVisible();
    // The proposed version + confidence are shown as text (not colour alone).
    await expect(candidate.locator('dd[data-proposed-version]')).toBeVisible();
    await expect(candidate.locator('dd[data-confidence]')).toBeVisible();
    // At least one supporting signal is listed (PRD §9.5 bottom panel).
    await expect(candidate.locator('li[data-signal-id]').first()).toBeVisible();
  });

  test('approve flow submits the decision and resumes the run', async ({ page }) => {
    const approve = page.getByRole('button', { name: 'Approve and replace repo skill' });
    await approve.focus();
    await expect(approve).toBeFocused();
    await expect(approve).toBeEnabled();
    await approve.click();

    // The worker (not the UI) performs the repo write; the UI confirms the resume.
    await expect(page.getByRole('status')).toContainText('approved');
    await expect(page.getByRole('status')).toContainText('resuming');
  });

  test('reject flow submits a rejected decision and resumes the run', async ({ page }) => {
    await page.getByRole('button', { name: 'Reject', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('rejected');
    await expect(page.getByRole('status')).toContainText('resuming');
  });

  test('a decision cannot be submitted without a reviewer name', async ({ page }) => {
    await page.getByLabel('Reviewer name').fill('');
    await page.getByRole('button', { name: 'Approve and replace repo skill' }).click();
    // No anonymous self-approval (constitution §5): the gate refuses and prompts for a name.
    await expect(page.getByRole('status')).toContainText('reviewer name');
  });
});
