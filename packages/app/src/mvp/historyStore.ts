// Local run-history store: the last few M+ runs the user analyzed, kept on-device as compressed,
// self-contained sub-logs so a run can be pulled back up (re-parsed → full report + replay) without
// re-importing the original multi-hundred-MB log. Purely local (IndexedDB); nothing leaves the
// browser. This is also the foundation for a later S3 backup/restore — the same per-run gzip blobs
// are what we'd push/pull.
//
// Storage: IndexedDB object store keyed by the run's stable `runHash` (so re-loading the same log
// dedupes). We keep MAX_RUNS most recent by run play-time. Everything degrades to a no-op when
// IndexedDB is unavailable (private mode, blocked), like the other client-only seams.

import type { FullReport } from '@wow/engine';

// Local retention floor: we always keep at least this many runs. A single dropped file that contains
// MORE runs than this keeps ALL of its runs (the caller passes `keep = max(thisFileRuns, MAX_RUNS)`),
// so a full night's key spree from one log survives — see App.persistRuns.
export const MAX_RUNS = 3;

const DB_NAME = 'mythiciq';
const DB_VERSION = 1;
const STORE = 'runs';

/** Metadata shown in the history list WITHOUT decompressing the log blob. */
export interface HistoryMeta {
  /** 'mplus' | 'raid' | 'other'; absent on records saved before raid support (treat as M+). */
  contentType?: string;
  dungeonName?: string;
  keystoneLevel?: number;
  completed?: boolean;
  abandoned?: boolean;
  chests?: number;
  completionTimeMs?: number;
  // Raid sessions
  instanceName?: string;
  difficultyName?: string;
  /** Boss name for a single-encounter raid run (carved boss pull); absent for multi-boss sessions. */
  bossName?: string;
  bossesKilled?: number;
  bossesPulled?: number;
  durationMs: number;
  deaths: number;
  affixes: number[];
  fileName: string;
}

/** A stored run: metadata + the gzipped sub-log bytes. */
export interface HistoryRecord {
  hash: string;
  /** epoch ms when this run was saved locally */
  savedAt: number;
  /** epoch ms of the run's first event (its real play-time) — the recency key for pruning */
  startedAtMs: number;
  /** gzipped size in bytes (for display; avoids reading the blob) */
  gzSize: number;
  meta: HistoryMeta;
  gz: Uint8Array;
  /** gzipped JSON of the run's SIDE-PANE data (a single-run FullReport) so the analysis panels can be
   *  shown INSTANTLY on open while the log re-parses in the background for the replay. Optional for
   *  back-compat with records saved before this existed (those fall back to a full re-parse). This is
   *  also the seam for remote history: the server delivers this blob while the gz log streams. */
  report?: Uint8Array;
}

/** List entry = a record minus the heavy blobs, plus a flag for whether the side-pane cache exists
 *  (so callers can decide to upgrade legacy records saved before the cache was added). */
export type HistoryEntry = Omit<HistoryRecord, 'gz' | 'report'> & { hasReport: boolean };

// ---- gzip helpers (native Compression Streams, no deps) ---------------------------------------

async function streamThrough(bytes: Uint8Array, transform: 'gzip' | 'gunzip'): Promise<Uint8Array> {
  const cs =
    transform === 'gzip' ? new CompressionStream('gzip') : new DecompressionStream('gzip');
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(cs);
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

export const gzip = (bytes: Uint8Array): Promise<Uint8Array> => streamThrough(bytes, 'gzip');
export const gunzip = (bytes: Uint8Array): Promise<Uint8Array> => streamThrough(bytes, 'gunzip');

// ---- IndexedDB plumbing ----------------------------------------------------------------------

function openDB(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null);
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      return resolve(null);
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'hash' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
}

function tx<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  body: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = body(t.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ---- public API ------------------------------------------------------------------------------

/** Save (or overwrite by hash) a run, then prune to the `keep` most recent (default MAX_RUNS). The
 *  caller passes a larger `keep` to retain all of one file's runs (max(thisFileRuns, MAX_RUNS)). */
export async function saveRun(record: HistoryRecord, keep = MAX_RUNS): Promise<void> {
  const db = await openDB();
  if (!db) return;
  try {
    await tx(db, 'readwrite', (s) => s.put(record));
    await pruneToMostRecent(keep);
  } catch {
    /* quota / unavailable — history is best-effort */
  } finally {
    db.close();
  }
}

/** All saved runs (metadata only), newest play-time first. */
export async function listRuns(): Promise<HistoryEntry[]> {
  const db = await openDB();
  if (!db) return [];
  try {
    const all = await tx<HistoryRecord[]>(db, 'readonly', (s) => s.getAll());
    return all
      .map(({ gz: _gz, report, ...rest }) => ({ ...rest, hasReport: report != null }))
      .sort((a, b) => b.startedAtMs - a.startedAtMs);
  } catch {
    return [];
  } finally {
    db.close();
  }
}

/** The gzipped sub-log bytes for one run, or null if missing. */
export async function loadRunBytes(hash: string): Promise<Uint8Array | null> {
  const db = await openDB();
  if (!db) return null;
  try {
    const rec = await tx<HistoryRecord | undefined>(db, 'readonly', (s) => s.get(hash));
    return rec ? rec.gz : null;
  } catch {
    return null;
  } finally {
    db.close();
  }
}

/** The cached SIDE-PANE data (single-run FullReport) for one run, or null if absent/unparseable.
 *  Lets the analysis panels render instantly while the gz log re-parses for the replay. */
export async function loadRunReport(hash: string): Promise<FullReport | null> {
  const db = await openDB();
  if (!db) return null;
  try {
    const rec = await tx<HistoryRecord | undefined>(db, 'readonly', (s) => s.get(hash));
    if (!rec?.report) return null;
    const json = new TextDecoder().decode(await gunzip(rec.report));
    return JSON.parse(json) as FullReport;
  } catch {
    return null;
  } finally {
    db.close();
  }
}

/** The raw gzipped side-pane report bytes for one run, or null if absent. Unlike `loadRunReport` this
 *  returns the stored gz Uint8Array as-is (no decode) — used to upload a run to the cloud for sharing. */
export async function loadRunReportBytes(hash: string): Promise<Uint8Array | null> {
  const db = await openDB();
  if (!db) return null;
  try {
    const rec = await tx<HistoryRecord | undefined>(db, 'readonly', (s) => s.get(hash));
    return rec?.report ?? null;
  } catch {
    return null;
  } finally {
    db.close();
  }
}

/** Backfill the side-pane cache onto an EXISTING record (for runs saved before the cache existed), so
 *  the next open is instant. No-op if the record is gone. */
export async function saveRunReport(hash: string, report: Uint8Array): Promise<void> {
  const db = await openDB();
  if (!db) return;
  try {
    const rec = await tx<HistoryRecord | undefined>(db, 'readonly', (s) => s.get(hash));
    if (!rec) return;
    rec.report = report;
    await tx(db, 'readwrite', (s) => s.put(rec));
  } catch {
    /* best-effort */
  } finally {
    db.close();
  }
}

/** Whether a run is already stored (used to skip re-extraction). */
export async function hasRun(hash: string): Promise<boolean> {
  const db = await openDB();
  if (!db) return false;
  try {
    const key = await tx<IDBValidKey | undefined>(db, 'readonly', (s) => s.getKey(hash));
    return key !== undefined;
  } catch {
    return false;
  } finally {
    db.close();
  }
}

export async function deleteRun(hash: string): Promise<void> {
  const db = await openDB();
  if (!db) return;
  try {
    await tx(db, 'readwrite', (s) => s.delete(hash));
  } catch {
    /* ignore */
  } finally {
    db.close();
  }
}

/** Keep only the `keep` most recent runs (by play-time); delete the rest. */
async function pruneToMostRecent(keep = MAX_RUNS): Promise<void> {
  const db = await openDB();
  if (!db) return;
  try {
    const all = await tx<HistoryRecord[]>(db, 'readonly', (s) => s.getAll());
    const stale = all
      .sort((a, b) => b.startedAtMs - a.startedAtMs)
      .slice(Math.max(keep, MAX_RUNS));
    for (const r of stale) await tx(db, 'readwrite', (s) => s.delete(r.hash));
  } catch {
    /* ignore */
  } finally {
    db.close();
  }
}
