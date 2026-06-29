import { test, expect } from '@playwright/test';
import { loadFixture, gotoApp } from './helpers.js';

// The core flow: drop a log → it parses → the replay loads in the stage and the side panels populate.
// This is the path that the replay duplicate-key crash slipped through, so it's the highest-value spec.

test.describe('load + analyze a run', () => {
  test('parses the fixture and shows the replay + run header', async ({ page }) => {
    await gotoApp(page);
    await loadFixture(page);

    // Replay is up in the stage (loaded by loadFixture); the run is identified.
    await expect(page.locator('.stage .rt')).toBeVisible();
    await expect(page.getByText('Pit of Saron').first()).toBeVisible();
    // A fresh load lands on Overview.
    await expect(page.locator('.side-title')).toHaveText('Overview');
    // No replay build error surfaced.
    await expect(page.locator('.stage .rp-error')).toHaveCount(0);
  });

  test('analysis tabs render for the loaded run', async ({ page }) => {
    await gotoApp(page);
    await loadFixture(page);

    for (const tab of ['Pulls', 'Role Review', 'Mechanics', 'Deaths', 'Insights']) {
      await page.locator('.railbtn', { hasText: tab }).click();
      await expect(page.locator('.side-title')).toHaveText(tab === 'Role Review' ? 'Role Review' : tab);
      // The panel rendered actual content, not the "load a log" empty state.
      await expect(page.locator('.side-empty')).toHaveCount(0);
    }
  });
});
