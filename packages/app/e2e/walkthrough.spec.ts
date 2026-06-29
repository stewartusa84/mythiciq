import { test, expect } from '@playwright/test';
import { loadFixture, gotoApp } from './helpers.js';

// First-run guided walkthrough: auto-opens over the first loaded run, steps through, persists when
// dismissed, and re-arms via Settings → Replay walkthrough.

test('the walkthrough auto-runs on the first load, advances, and persists when finished', async ({ page }) => {
  await gotoApp(page, { tour: true }); // do NOT suppress the tour for this spec
  await loadFixture(page);

  // It auto-opens (after a short layout delay) with a spotlight + step 1 of N.
  const card = page.locator('.tour-card');
  await expect(card).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.tour-hole')).toBeVisible();
  await expect(card.locator('.tc-step')).toHaveText(/Step 1 of \d/);

  // Step through to the end.
  const total = Number((await card.locator('.tc-step').textContent())?.match(/of (\d)/)?.[1] ?? '0');
  expect(total).toBeGreaterThan(1);
  for (let i = 1; i < total; i++) {
    await card.locator('.tc-btn.primary').click(); // Next
    await expect(card.locator('.tc-step')).toHaveText(new RegExp(`Step ${i + 1} of`));
  }
  await expect(card.locator('.tc-btn.primary')).toHaveText('Got it');
  await card.locator('.tc-btn.primary').click();
  await expect(card).toHaveCount(0);

  // Reload — it must not auto-run again (tourSeen persisted).
  await page.reload();
  await loadFixture(page);
  await expect(page.locator('.tour-card')).toHaveCount(0);
});

test('the walkthrough can be skipped and replayed from Settings', async ({ page }) => {
  await gotoApp(page, { tour: true });
  await loadFixture(page);

  const card = page.locator('.tour-card');
  await expect(card).toBeVisible({ timeout: 10_000 });
  await card.locator('.tc-skip').click();
  await expect(card).toHaveCount(0);

  // Replay it from Settings (opened via the account menu). The first-time share-stats hint popover can
  // overlap the account dropdown and swallow the click, so dismiss it first if it's showing.
  const hintX = page.locator('.hint .hint-x');
  if (await hintX.count()) await hintX.click();
  await page.locator('button.acctbtn').click();
  await page.locator('.acctmenu .acctitem', { hasText: 'Settings' }).click();
  const settings = page.locator('.modal[aria-label="Account & Settings"]');
  await expect(settings).toBeVisible();
  await settings.locator('button.replay', { hasText: 'Replay walkthrough' }).click();
  // Modal closes and the tour comes back.
  await expect(page.locator('.tour-card')).toBeVisible({ timeout: 10_000 });
});
