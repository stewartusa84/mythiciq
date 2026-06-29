// Desktop (Tauri) on-disk run history — the durable, folder-backed counterpart of the web's IndexedDB
// `historyStore.ts`. Same per-run gzip blobs + side-pane cache, but written to a real folder so players
// can DELETE their raw WoW logs (which are huge, and many addons/companions auto-purge) while keeping the
// compressed run data for replay/analysis. Same API surface as historyStore so `history.ts` can swap
// between them by platform. Mirrors the cloud RunBackupStore layout: one dir per run hash.
//
// Layout:  <historyDir>/<hash>/meta.json   (list-row metadata, no decompress needed)
//          <historyDir>/<hash>/log.gz      (gzipped standalone sub-log → re-parse for the replay)
//          <historyDir>/<hash>/report.gz   (gzipped single-run FullReport → instant side panes)

import type { FullReport } from '@wow/engine';
import type { HistoryEntry, HistoryRecord } from './historyStore.js';
import { gunzip } from './historyStore.js';
import { settings } from './settings.svelte.js';

const fs = () => import('@tauri-apps/plugin-fs');
const pathApi = () => import('@tauri-apps/api/path');
const core = () => import('@tauri-apps/api/core');

// Resolved once per session: the native default history dir (already created + fs-scope-authorized by
// the Rust `default_history_dir` command). A future "change folder" feature would clear this cache.
let cachedDir: string | null = null;
async function baseDir(): Promise<string> {
  if (cachedDir) return cachedDir;
  const { invoke } = await core();
  cachedDir = await invoke<string>('default_history_dir');
  return cachedDir;
}

async function runDir(hash: string): Promise<string> {
  const { join } = await pathApi();
  return join(await baseDir(), hash);
}

interface MetaFile {
  hash: string;
  savedAt: number;
  startedAtMs: number;
  gzSize: number;
  hasReport: boolean;
  meta: HistoryRecord['meta'];
}

export async function saveRun(record: HistoryRecord, keep = settings.historyCap): Promise<void> {
  try {
    const { join } = await pathApi();
    const { mkdir, writeFile, writeTextFile } = await fs();
    const d = await runDir(record.hash);
    await mkdir(d, { recursive: true });
    await writeFile(await join(d, 'log.gz'), record.gz);
    if (record.report) await writeFile(await join(d, 'report.gz'), record.report);
    const meta: MetaFile = {
      hash: record.hash,
      savedAt: record.savedAt,
      startedAtMs: record.startedAtMs,
      gzSize: record.gzSize,
      hasReport: record.report != null,
      meta: record.meta,
    };
    await writeTextFile(await join(d, 'meta.json'), JSON.stringify(meta));
    await pruneToMostRecent(keep);
  } catch {
    /* disk full / permission — history is best-effort, like the IndexedDB path */
  }
}

export async function listRuns(): Promise<HistoryEntry[]> {
  try {
    const { join } = await pathApi();
    const { readDir, readTextFile, mkdir } = await fs();
    const base = await baseDir();
    await mkdir(base, { recursive: true });
    const entries = await readDir(base);
    const out: HistoryEntry[] = [];
    for (const e of entries) {
      if (!e.isDirectory) continue;
      try {
        const m = JSON.parse(await readTextFile(await join(base, e.name, 'meta.json'))) as MetaFile;
        out.push({ hash: m.hash, savedAt: m.savedAt, startedAtMs: m.startedAtMs, gzSize: m.gzSize, meta: m.meta, hasReport: m.hasReport });
      } catch {
        /* skip a partial/corrupt run dir */
      }
    }
    return out.sort((a, b) => b.startedAtMs - a.startedAtMs);
  } catch {
    return [];
  }
}

export async function loadRunBytes(hash: string): Promise<Uint8Array | null> {
  try {
    const { join } = await pathApi();
    const { readFile } = await fs();
    return await readFile(await join(await runDir(hash), 'log.gz'));
  } catch {
    return null;
  }
}

export async function loadRunReport(hash: string): Promise<FullReport | null> {
  try {
    const { join } = await pathApi();
    const { readFile } = await fs();
    const gz = await readFile(await join(await runDir(hash), 'report.gz'));
    return JSON.parse(new TextDecoder().decode(await gunzip(gz))) as FullReport;
  } catch {
    return null;
  }
}

export async function loadRunReportBytes(hash: string): Promise<Uint8Array | null> {
  try {
    const { join } = await pathApi();
    const { readFile } = await fs();
    return await readFile(await join(await runDir(hash), 'report.gz'));
  } catch {
    return null;
  }
}

export async function saveRunReport(hash: string, report: Uint8Array): Promise<void> {
  try {
    const { join } = await pathApi();
    const { writeFile, readTextFile, writeTextFile, exists } = await fs();
    const d = await runDir(hash);
    if (!(await exists(await join(d, 'meta.json')))) return; // record gone — nothing to backfill
    await writeFile(await join(d, 'report.gz'), report);
    try {
      const m = JSON.parse(await readTextFile(await join(d, 'meta.json'))) as MetaFile;
      m.hasReport = true;
      await writeTextFile(await join(d, 'meta.json'), JSON.stringify(m));
    } catch {
      /* meta rewrite is non-critical */
    }
  } catch {
    /* best-effort */
  }
}

export async function hasRun(hash: string): Promise<boolean> {
  try {
    const { join } = await pathApi();
    const { exists } = await fs();
    return await exists(await join(await runDir(hash), 'meta.json'));
  } catch {
    return false;
  }
}

export async function deleteRun(hash: string): Promise<void> {
  try {
    const { remove } = await fs();
    await remove(await runDir(hash), { recursive: true });
  } catch {
    /* ignore */
  }
}

/** Keep only the `keep` most recent runs (by play-time); delete the rest. */
async function pruneToMostRecent(keep = settings.historyCap): Promise<void> {
  try {
    const { remove } = await fs();
    const all = await listRuns(); // already newest-first
    const stale = all.slice(Math.max(1, keep));
    for (const e of stale) await remove(await runDir(e.hash), { recursive: true });
  } catch {
    /* ignore */
  }
}
