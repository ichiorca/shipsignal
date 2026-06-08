// T5 (spec 004) — Playwright config for the Gate #1 e2e (AC5). Kept under e2e/ and
// excluded from tsc/node --test (Playwright is a separate runner with its own deps).
// Run: npx playwright test --config e2e/playwright.config.ts
//
// e2e is opt-in: install with `npm i -D @playwright/test && npx playwright install`,
// point BASE_URL at a running dashboard, then run the command above.

import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
  },
});
