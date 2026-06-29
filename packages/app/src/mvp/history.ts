// History facade: one import surface for run history that routes to the right backend per platform.
// Desktop (Tauri) → an on-disk folder (desktopHistory.ts), so runs survive deleting the raw WoW logs and
// retention is generous + configurable. Web → IndexedDB (historyStore.ts), capped at MAX_RUNS. The
// gzip/gunzip helpers + types come straight from historyStore (platform-neutral). App.svelte imports
// from HERE, never the concrete stores, so the swap is invisible to callers.

import { isDesktop } from './desktop.js';
import * as idb from './historyStore.js';
import * as disk from './desktopHistory.js';

export { gzip, gunzip, MAX_RUNS } from './historyStore.js';
export type { HistoryEntry, HistoryRecord, HistoryMeta } from './historyStore.js';

const desktop = isDesktop();

export const listRuns = (...a: Parameters<typeof idb.listRuns>) => (desktop ? disk.listRuns(...a) : idb.listRuns(...a));
export const saveRun = (...a: Parameters<typeof idb.saveRun>) => (desktop ? disk.saveRun(...a) : idb.saveRun(...a));
export const saveRunReport = (...a: Parameters<typeof idb.saveRunReport>) => (desktop ? disk.saveRunReport(...a) : idb.saveRunReport(...a));
export const loadRunBytes = (...a: Parameters<typeof idb.loadRunBytes>) => (desktop ? disk.loadRunBytes(...a) : idb.loadRunBytes(...a));
export const loadRunReport = (...a: Parameters<typeof idb.loadRunReport>) => (desktop ? disk.loadRunReport(...a) : idb.loadRunReport(...a));
export const loadRunReportBytes = (...a: Parameters<typeof idb.loadRunReportBytes>) => (desktop ? disk.loadRunReportBytes(...a) : idb.loadRunReportBytes(...a));
export const hasRun = (...a: Parameters<typeof idb.hasRun>) => (desktop ? disk.hasRun(...a) : idb.hasRun(...a));
export const deleteRun = (...a: Parameters<typeof idb.deleteRun>) => (desktop ? disk.deleteRun(...a) : idb.deleteRun(...a));
