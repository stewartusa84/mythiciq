import { test, expect } from '@playwright/test';

// Topbar chrome + landing structure — no log needed. Covers the Notifications bell dropdown (cards that
// dismiss / navigate), the changelog now living in Settings → "What's new", and the trimmed browser
// shell (dropzone-first, no desktop-only history/capture surfaces).

// Settings opens from the account menu (gear icon → "Settings"), not a standalone button.
async function openSettings(page: import('@playwright/test').Page) {
  await page.locator('button.acctbtn').click();
  await page.locator('.acctmenu .acctitem', { hasText: 'Settings' }).click();
}

test.describe('landing + topbar chrome', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('landing shows the dropzone and hides desktop-only History/Capture in the web shell', async ({ page }) => {
    await expect(page.locator('.stage .drop')).toBeVisible();
    await expect(page.locator('.stage .beta-pill')).toBeVisible(); // BETA under the logo
    await expect(page.locator('.side-title')).toHaveText('Overview');
    await expect(page.locator('.railbtn', { hasText: 'History' })).toHaveCount(0);
    await expect(page.locator('.secheader', { hasText: 'Capture' })).toHaveCount(0);
    await expect(page.locator('.secheader', { hasText: 'Groups' })).toBeVisible();
  });

  test('bell opens the notifications dropdown and clears the unread badge', async ({ page }) => {
    // A fresh client has never opened notifications, so unread changelog entries show a badge.
    await expect(page.locator('.bell .badge')).toBeVisible();
    await page.locator('button.bellbtn').click();
    const menu = page.locator('.menu[aria-label="Notifications"]');
    await expect(menu).toBeVisible();
    await expect(menu.locator('.ncard').first()).toBeVisible();
    // Opening marks everything read → close and the badge is gone.
    await page.keyboard.press('Escape');
    await expect(page.locator('.bell .badge')).toHaveCount(0);
  });

  test('a notification card can be dismissed', async ({ page }) => {
    await page.locator('button.bellbtn').click();
    const menu = page.locator('.menu[aria-label="Notifications"]');
    const first = menu.locator('.ncard').first();
    await expect(first).toBeVisible();
    // Title is unique per entry; once dismissed it must not reappear (the list backfills from the capped
    // changelog, so the total count can stay the same — assert the specific card is gone).
    const title = (await first.locator('.nc-title').textContent())!.trim();
    await first.locator('.nc-x').click();
    await expect(menu.locator('.nc-title', { hasText: title })).toHaveCount(0);
  });

  test('the changelog now lives in Settings → "What\'s new"', async ({ page }) => {
    await openSettings(page);
    const settings = page.locator('.modal[aria-label="Account & Settings"]');
    await expect(settings).toBeVisible();
    await expect(settings.locator('.toggle', { hasText: 'Share anonymized run stats' })).toBeVisible();
    await expect(settings.locator('.sec', { hasText: "What's new" })).toBeVisible();
    await expect(settings.locator('.cl-entry').first()).toBeVisible(); // full changelog moved into Settings
  });
});
