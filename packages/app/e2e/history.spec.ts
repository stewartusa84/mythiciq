import { test, expect, type Page } from '@playwright/test';
import { loadFixture, gotoApp } from './helpers.js';

// Web app trim: downloaded-app conveniences stay hidden here. A dropped log is fully analyzed, but the
// browser build does not expose or populate local run history.

async function storedRunCount(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const dbs = await indexedDB.databases?.();
    if (dbs && !dbs.some((db) => db.name === 'mythiciq')) return 0;
    return new Promise<number>((resolve) => {
      const req = indexedDB.open('mythiciq');
      req.onerror = () => resolve(0);
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('runs')) {
          db.close();
          resolve(0);
          return;
        }
        const tx = db.transaction('runs', 'readonly');
        const count = tx.objectStore('runs').count();
        count.onsuccess = () => {
          db.close();
          resolve(count.result);
        };
        count.onerror = () => {
          db.close();
          resolve(0);
        };
      };
      req.onupgradeneeded = () => {
        req.result.close();
        resolve(0);
      };
    });
  });
}

test('a loaded run is not saved to browser history', async ({ page }) => {
  await gotoApp(page);
  await expect(page.locator('.railbtn', { hasText: 'History' })).toHaveCount(0);
  await loadFixture(page);

  await expect(page.locator('.stage .rt')).toBeVisible();
  await expect(page.getByText('Pit of Saron').first()).toBeVisible();
  await expect(page.locator('.railbtn', { hasText: 'History' })).toHaveCount(0);
  await expect.poll(() => storedRunCount(page)).toBe(0);

  // Reloading returns to the dropzone; there is no browser-history reopen path.
  await page.locator('.brand').click();
  await expect(page.locator('.stage .drop')).toBeVisible();
  await expect(page.locator('.railbtn', { hasText: 'History' })).toHaveCount(0);
});
