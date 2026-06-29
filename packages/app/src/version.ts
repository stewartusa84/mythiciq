// Build-time app version. Replaced by Vite's `define` (__APP_VERSION__) at build with
// `${pkg.version}+${gitSha}` (or VITE_APP_VERSION in CI). Shown in Settings and sent with all backend
// payloads so an out-of-date client is visible to both the user and us.
declare const __APP_VERSION__: string;

export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';

// Build-time "last updated" date (ISO string), injected by Vite's `define` (__BUILD_DATE__). Shown on
// the landing page so visitors can see the project is actively maintained. Falls back to now in dev.
declare const __BUILD_DATE__: string;

export const BUILD_DATE: string = typeof __BUILD_DATE__ === 'string' ? __BUILD_DATE__ : new Date().toISOString();
