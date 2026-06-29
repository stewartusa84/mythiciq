// Desktop (Tauri) seam. The ONLY place the web app touches Tauri APIs. Every entry point is guarded
// by `isDesktop()` and uses dynamic imports, so in a plain browser this module is inert and the Tauri
// packages never run. The native side (packages/app/src-tauri) watches the WoW logs folder, carves
// each completed M+ run into a standalone sub-log, and emits a `run-carved` event; the app fetches the
// run's bytes on demand and feeds them through the SAME parse path used for drag-drop / history opens.

/** Headline metadata for a carved run/pull, parsed natively from its START/END lines so a
 *  toast/notification can show it WITHOUT fetching or parsing the full sub-log. `kind` routes M+ runs
 *  (the notifications bell) vs raid pulls (the boss-grouped Pulls feed). */
export type CarvedRun = {
  id: number;
  fileName: string;
  lines: number;
  /** `'mplus'` = a CHALLENGE_MODE run; `'raid-encounter'` = a single raid boss pull (wipe or kill). */
  kind: 'mplus' | 'raid-encounter';
  /** True for runs already in the file when watching started (the initial backfill scan). */
  backfill: boolean;
  /** M+ dungeon name — null for raid pulls. */
  dungeon: string | null;
  /** M+ keystone level — null for raid pulls. */
  level: number | null;
  /** Raid boss name — null for M+ runs. */
  bossName: string | null;
  /** Outcome: M+ key success, or raid kill (true) / wipe (false). */
  success: boolean | null;
  durationMs: number | null;
};

export function isDesktop(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

const core = () => import('@tauri-apps/api/core');
const events = () => import('@tauri-apps/api/event');

/** The standard retail Logs folder if it exists on this machine, else null. */
export async function defaultLogDir(): Promise<string | null> {
  if (!isDesktop()) return null;
  const { invoke } = await core();
  return (await invoke<string | null>('default_log_dir')) ?? null;
}

/** The folder where the desktop app stores compressed run sub-logs (`<local-app-data>/history`), or null
 *  off-desktop. Surfaced in Settings so players can find/clear the saved run data. */
export async function historyDir(): Promise<string | null> {
  if (!isDesktop()) return null;
  try {
    const { invoke } = await core();
    return (await invoke<string | null>('default_history_dir')) ?? null;
  } catch {
    return null;
  }
}

/** Whether the desktop app is a DEBUG build (`tauri dev` / `tauri build --debug`). Lets a standalone
 *  debug build show the DEV reset panel; release builds (and the web app) return false. */
export async function isDebugBuild(): Promise<boolean> {
  if (!isDesktop()) return false;
  try {
    const { invoke } = await core();
    return (await invoke<boolean>('is_debug_build')) === true;
  } catch {
    return false;
  }
}

export async function startWatching(dir: string): Promise<void> {
  if (!isDesktop()) return;
  const { invoke } = await core();
  await invoke('start_watching', { dir });
}

export async function stopWatching(): Promise<void> {
  if (!isDesktop()) return;
  const { invoke } = await core();
  await invoke('stop_watching');
}

/** Low-resource mode: when enabled, the native side tears down the webview a few seconds after the
 *  window is minimized to the tray (the log watcher keeps running); the tray "Show" rebuilds it. Mirror
 *  the Settings toggle to the native side on startup and on every change. No-op off-desktop. */
export async function setLowResourceMode(enabled: boolean): Promise<void> {
  if (!isDesktop()) return;
  const { invoke } = await core();
  await invoke('set_low_resource_mode', { enabled });
}

/** Fully quit the desktop app. The window's X only minimizes to the tray (the app keeps watching), so
 *  this is the explicit "Quit" path from the UI menu. No-op off-desktop. */
export async function quitApp(): Promise<void> {
  if (!isDesktop()) return;
  const { invoke } = await core();
  await invoke('quit_app');
}

/** Fetch (and consume) a carved run's standalone sub-log bytes. Returned as raw bytes from the native
 *  side (a `tauri::ipc::Response`), not JSON, so a multi-MB run doesn't balloon over the IPC bridge. */
export async function takeCarvedRun(id: number): Promise<Uint8Array> {
  const { invoke } = await core();
  const buf = await invoke<ArrayBuffer>('take_carved_run', { id });
  return new Uint8Array(buf);
}

/** Native folder picker. Returns the chosen path or null if cancelled / not desktop. */
export async function pickFolder(defaultPath?: string): Promise<string | null> {
  if (!isDesktop()) return null;
  const { open } = await import('@tauri-apps/plugin-dialog');
  const res = await open({ directory: true, multiple: false, defaultPath: defaultPath ?? undefined });
  return typeof res === 'string' ? res : null;
}

/** Open an external URL in the SYSTEM browser. In a Tauri webview a plain `target="_blank"` anchor goes
 *  nowhere, so external links (Wowhead, etc.) must be routed through the opener plugin. No-op off-desktop. */
export async function openExternal(url: string): Promise<void> {
  if (!isDesktop()) return;
  try {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(url);
  } catch (e) {
    // Best-effort — never break the click — but log it: a silent failure here (e.g. an opener ACL/scope
    // mismatch) is exactly what made this look like "nothing happens".
    console.warn('openExternal failed for', url, e);
  }
}

/** DESKTOP ONLY: capture clicks on external http(s) links anywhere in the document and open them in the
 *  system browser (instead of letting them no-op or hijack the webview). Installed once at startup; the
 *  Wowhead links (rendered dynamically + rewritten by tooltips.js) are the main beneficiary, so a single
 *  delegated listener on the document is more robust than per-link wiring. Returns a remover. No-op
 *  off-desktop. */
export function installDesktopLinkHandler(): () => void {
  if (!isDesktop() || typeof document === 'undefined') return () => {};
  const onClick = (e: MouseEvent) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
    const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
    if (!a) return;
    const href = a.href; // resolved absolute URL
    if (!/^https?:\/\//i.test(href)) return; // leave in-app / mailto / tauri links alone
    e.preventDefault();
    void openExternal(href);
  };
  document.addEventListener('click', onClick, true); // capture, so it beats Wowhead's own handlers
  return () => document.removeEventListener('click', onClick, true);
}

/** Best-effort OS notification (requests permission on first use). No-op off-desktop. */
export async function notify(title: string, body: string): Promise<void> {
  if (!isDesktop()) return;
  try {
    const n = await import('@tauri-apps/plugin-notification');
    let granted = await n.isPermissionGranted();
    if (!granted) granted = (await n.requestPermission()) === 'granted';
    if (granted) n.sendNotification({ title, body });
  } catch {
    /* notifications are best-effort — never break the parse flow */
  }
}

/** Desktop OAuth (RFC 8252): open the system browser to the Cognito Hosted UI `authorizeUrl` and capture
 *  the loopback redirect natively, returning the OAuth `code`/`state` for the PKCE token exchange. The
 *  native side (src-tauri/src/auth.rs) opens the browser + runs a one-shot localhost listener. Throws
 *  off-desktop (callers gate on isDesktop()). */
export async function oauthCapture(authorizeUrl: string): Promise<{ code?: string; state?: string; error?: string }> {
  const { invoke } = await core();
  return invoke('oauth_capture', { authorizeUrl });
}

/** Subscribe to completed-run events. Resolves to an unlisten function. */
export async function onRunCarved(cb: (run: CarvedRun) => void): Promise<() => void> {
  if (!isDesktop()) return () => {};
  const { listen } = await events();
  return listen<CarvedRun>('run-carved', (e) => cb(e.payload));
}

/** Fires once after the initial backfill scan finishes, with the number of runs it found. */
export async function onBackfillComplete(cb: (count: number) => void): Promise<() => void> {
  if (!isDesktop()) return () => {};
  const { listen } = await events();
  return listen<{ count: number }>('backfill-complete', (e) => cb(e.payload.count));
}

/** Window hidden to the tray (the X minimizes to tray; see src-tauri main.rs). Used by the load
 *  benchmark to bracket how long the window sat in the tray. Resolves to an unlisten function. */
export async function onWindowHidden(cb: () => void): Promise<() => void> {
  if (!isDesktop()) return () => {};
  const { listen } = await events();
  return listen('window-hidden', () => cb());
}

/** Window restored from the tray (see src-tauri tray.rs). Used by the load benchmark to time the
 *  show→first-paint latency. Resolves to an unlisten function. */
export async function onWindowShown(cb: () => void): Promise<() => void> {
  if (!isDesktop()) return () => {};
  const { listen } = await events();
  return listen('window-shown', () => cb());
}
