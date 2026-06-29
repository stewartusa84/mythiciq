import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

// Build-time version string shown in Settings + sent with all backend payloads, so an older client is
// visible. CI sets VITE_APP_VERSION (e.g. the release tag); otherwise we fall back to package.json
// version + the short git sha so even local/dev builds are identifiable.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };
function gitSha(): string {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'dev';
  }
}
const appVersion = process.env.VITE_APP_VERSION ?? `${pkg.version}+${gitSha()}`;

// Build/last-update date, shown on the landing page so the project visibly isn't abandoned. CI sets
// VITE_BUILD_DATE (the deploy time); locally we fall back to HEAD's commit date, else the build clock.
function lastCommitDate(): string {
  try {
    return execSync('git log -1 --format=%cI', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return new Date().toISOString();
  }
}
const buildDate = process.env.VITE_BUILD_DATE ?? lastCommitDate();

export default defineConfig(({ mode }) => ({
  define: { __APP_VERSION__: JSON.stringify(appVersion), __BUILD_DATE__: JSON.stringify(buildDate) },
  plugins: [svelte()],
  // Keep browser dev on the registered Cognito callback port (5173), while desktop mode uses 5175 so the
  // marketing site can occupy 5173 and its proxied analyzer web app can occupy 5174 at the same time. Desktop
  // auth uses its own fixed loopback callback (:8765), so its Vite port is not part of the OAuth redirect.
  // `strictPort` makes clashes fail loudly instead of silently drifting to a confusing URL.
  server: { port: mode === 'desktop' ? 5175 : 5173, strictPort: true },
  // Preview stays on 4173 to match the Playwright e2e webServer (playwright.config.ts).
  preview: { port: 4173, strictPort: true },
  optimizeDeps: {
    // Crawl the parse worker's module graph at server startup. By default Vite only
    // scans index.html, so the worker's deps aren't discovered until it first
    // instantiates (on the first file-load) — at which point Vite re-optimizes and
    // forces a full-page reload, wiping the loaded report mid-session. Listing the
    // worker entry here makes that discovery happen before the page is interactive.
    entries: ['index.html', '../engine/src/worker/parse.worker.ts'],
  },
  worker: {
    // The parse worker is an ES module worker.
    format: 'es',
  },
  // Allow importing the .wasm artifact from the parser-core package as a URL.
  assetsInclude: ['**/*.wasm'],
}));
