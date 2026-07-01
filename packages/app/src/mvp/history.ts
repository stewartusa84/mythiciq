// History facade: one import surface for run history that routes to the right backend per platform.
// Desktop (Tauri) → an on-disk folder (desktopHistory.ts), so runs survive deleting the raw WoW logs and
// retention is generous + configurable. Web → IndexedDB (historyStore.ts), capped at MAX_RUNS. The
// gzip/gunzip helpers + types come straight from historyStore (platform-neutral). App.svelte imports
// from HERE, never the concrete stores, so the swap is invisible to callers.

import { isDesktop } from './desktop.js';
import * as idb from './historyStore.js';
import * as disk from './desktopHistory.js';
import type { HistoryEntry } from './historyStore.js';

export { gzip, gunzip, MAX_RUNS } from './historyStore.js';
export type { HistoryEntry, HistoryRecord, HistoryMeta } from './historyStore.js';

const desktop = isDesktop();

// A lightweight (couple-KB) snapshot of the run list, cached in localStorage so it survives a
// low-resource-mode webview teardown (which destroys all in-webview JS state). On restore the History
// list renders instantly from this cache while the real backend — the desktop on-disk folder scan (a
// meta.json read per run across the Tauri IPC boundary) or the web IndexedDB getAll — reconciles in the
// background, so the user doesn't watch every saved run re-index. Metadata only; the heavy gz log/report
// blobs are never cached here.
const LIST_CACHE_KEY = 'mythiciq.historyList.v1';

/** Synchronous read of the cached run list (metadata only). Returns [] if absent/unreadable — the
 *  caller then falls back to an async listRuns(). */
export function cachedRuns(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(LIST_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as HistoryEntry[]) : [];
  } catch {
    return [];
  }
}

function writeListCache(entries: HistoryEntry[]): void {
  try {
    localStorage.setItem(LIST_CACHE_KEY, JSON.stringify(entries));
  } catch {
    /* quota / unavailable — the cache is a best-effort optimization */
  }
}

export const listRuns = async (...a: Parameters<typeof idb.listRuns>): Promise<HistoryEntry[]> => {
  const entries = await (desktop ? disk.listRuns(...a) : idb.listRuns(...a));
  writeListCache(entries); // keep the fast-restore cache current on every real listing
  return entries;
};
export const saveRun = (...a: Parameters<typeof idb.saveRun>) => (desktop ? disk.saveRun(...a) : idb.saveRun(...a));
export const saveRunReport = (...a: Parameters<typeof idb.saveRunReport>) => (desktop ? disk.saveRunReport(...a) : idb.saveRunReport(...a));
export const loadRunBytes = (...a: Parameters<typeof idb.loadRunBytes>) => (desktop ? disk.loadRunBytes(...a) : idb.loadRunBytes(...a));
export const loadRunReport = (...a: Parameters<typeof idb.loadRunReport>) => (desktop ? disk.loadRunReport(...a) : idb.loadRunReport(...a));
export const loadRunReportBytes = (...a: Parameters<typeof idb.loadRunReportBytes>) => (desktop ? disk.loadRunReportBytes(...a) : idb.loadRunReportBytes(...a));
export const hasRun = (...a: Parameters<typeof idb.hasRun>) => (desktop ? disk.hasRun(...a) : idb.hasRun(...a));
export const deleteRun = (...a: Parameters<typeof idb.deleteRun>) => (desktop ? disk.deleteRun(...a) : idb.deleteRun(...a));
