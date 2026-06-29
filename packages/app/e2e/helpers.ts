import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { Page } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));
export const FIXTURE_LOG = join(here, 'fixtures', 'mini-run.log');

/** Navigate to the app. By default suppresses the first-run walkthrough (seeds `tourSeen:true`) so the
 *  tour scrim doesn't block the specs; pass `{ tour: true }` in the walkthrough spec to let it run. */
export async function gotoApp(page: Page, opts: { tour?: boolean } = {}): Promise<void> {
  if (!opts.tour) {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('wow.settings.v1', JSON.stringify({ tourSeen: true }));
      } catch {
        /* ignore */
      }
    });
  }
  await page.goto('/');
}

/** Drop the mini fixture log into the stage's file input and wait until the run is analyzed (the
 *  run-timeline `.rt` appears in the stage and the loader is gone). */
export async function loadFixture(page: Page): Promise<void> {
  await page.locator('.stage input[type=file]').setInputFiles(FIXTURE_LOG);
  await page.locator('.stage .rt').waitFor({ state: 'visible', timeout: 45_000 });
}
