import { test, expect } from '@playwright/test';
import { loadFixture, gotoApp } from './helpers.js';

// Custom metrics → bands on the replay timeline. Regression guard: a watched metric must draw its
// colored band(s) under the run-timeline chart. The fixture has Boomy cast Wrath (190984) hitting one
// enemy, so a "cast hit fewer than 99 targets" metric flags it → at least one band.

test('a watched custom metric draws bands under the replay timeline', async ({ page }) => {
  await gotoApp(page);
  await loadFixture(page);

  await page.locator('.railbtn', { hasText: 'Insights' }).click();
  await expect(page.locator('.side-title')).toHaveText('Insights');

  // Create a targets-hit metric for Wrath (190984) that the fixture's single-target cast will trip.
  await page.locator('.side-body button.primary', { hasText: 'Create metric' }).click();
  const modal = page.locator('.modal');
  await expect(modal).toBeVisible();
  await modal.locator('select').nth(0).selectOption('targets-hit'); // "When"
  await modal.locator('select').nth(1).selectOption('players'); // "For"
  await modal.locator('input.num[placeholder^="e.g. 101546"]').fill('190984');
  await modal.locator('input.num[title*="FEWER"]').fill('99');
  await modal.locator('button.primary').first().click(); // Done (saves + activates + evaluates)

  // The band shows under the timeline, with its gutter badge.
  await expect(page.locator('.stage .rt-band').first()).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.stage .rt-mbadge').first()).toBeVisible();
});
