// Cloud run-backup client — the browser side of the backend's authed /api/runs routes. Backs up a
// run's two gz blobs (report = instant side-pane data, log = the sub-log re-parsed for the replay) and
// its list-row metadata, so a signed-in user can pull a run back up on another device. Mirrors the
// local IndexedDB history (historyStore.ts); this is the same per-run gzip blob, sent over the wire.
//
// No-ops (returns a configured:false result) unless BOTH a backend (VITE_BACKEND_URL) and Cognito
// (auth.configured) are set AND the user is signed in. Blobs move via presigned S3 URLs in prod, or
// stream through the API locally — the backend tells us which via `mode`.

import { auth } from './auth.svelte.js';
import type { HistoryMeta } from './historyStore.js';

const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL as string | undefined)?.replace(/\/$/, '');

export type BlobKind = 'report' | 'log';

/** Metadata sent up with a backup (the local list-row meta + run play-time + sizes). */
export interface CloudRunMeta extends HistoryMeta {
  startedAtMs: number;
  logGzSize?: number;
  reportGzSize?: number;
}

/** A backup as the server lists it. */
export interface CloudRun {
  hash: string;
  savedAt: number;
  startedAtMs: number;
  meta: CloudRunMeta;
}

interface TransferTargets {
  mode: 'presigned' | 'direct';
  report: string;
  log: string;
}

export type CloudResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** Sign-in + backup are possible (backend + Cognito configured). The user may still be signed out. */
export function cloudConfigured(): boolean {
  return !!BACKEND_URL && auth.configured;
}

async function authHeader(): Promise<Record<string, string>> {
  const token = await auth.getAccessToken();
  if (!token) throw new Error('signed out');
  return { Authorization: `Bearer ${token}` };
}

/** Resolve a transfer URL: presigned URLs are absolute; direct paths are relative to the API base. */
function resolveUrl(url: string): string {
  return url.startsWith('http') ? url : `${BACKEND_URL}${url}`;
}

async function api<T>(method: string, path: string, jsonBody?: unknown): Promise<T> {
  const headers: Record<string, string> = { ...(await authHeader()) };
  if (jsonBody !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${BACKEND_URL}${path}`, {
    method,
    headers,
    body: jsonBody !== undefined ? JSON.stringify(jsonBody) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}`);
  return (res.status === 204 ? undefined : await res.json()) as T;
}

/** PUT one gz blob to its target — presigned (no auth header) or direct (auth header). */
async function putBlob(target: TransferTargets, which: BlobKind, bytes: Uint8Array): Promise<void> {
  const url = resolveUrl(target[which]);
  const headers: Record<string, string> = { 'Content-Type': 'application/gzip' };
  if (target.mode === 'direct') Object.assign(headers, await authHeader());
  const res = await fetch(url, { method: 'PUT', headers, body: bytes as BodyInit });
  if (!res.ok) throw new Error(`upload ${which} → ${res.status}`);
}

async function getBlob(target: TransferTargets, which: BlobKind): Promise<Uint8Array> {
  const url = resolveUrl(target[which]);
  const headers: Record<string, string> = {};
  if (target.mode === 'direct') Object.assign(headers, await authHeader());
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`download ${which} → ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

/** List the signed-in user's cloud backups (newest play-time first). */
export async function listCloudRuns(): Promise<CloudResult<CloudRun[]>> {
  if (!cloudConfigured()) return { ok: false, error: 'cloud backup not configured' };
  try {
    const { runs } = await api<{ runs: CloudRun[] }>('GET', '/api/runs');
    return { ok: true, value: runs };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Back up one run: store its metadata, then upload both gz blobs. */
export async function backupRun(
  hash: string,
  meta: CloudRunMeta,
  reportGz: Uint8Array,
  logGz: Uint8Array,
): Promise<CloudResult<{ pruned: string[] }>> {
  if (!cloudConfigured()) return { ok: false, error: 'cloud backup not configured' };
  try {
    const resp = await api<{ upload: TransferTargets; pruned: string[] }>('POST', `/api/runs/${hash}`, {
      meta: { ...meta, reportGzSize: reportGz.byteLength, logGzSize: logGz.byteLength },
    });
    await putBlob(resp.upload, 'report', reportGz);
    await putBlob(resp.upload, 'log', logGz);
    return { ok: true, value: { pruned: resp.pruned } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Fetch a backed-up run's metadata + both gz blobs (for restore → re-parse). */
export async function fetchCloudRun(
  hash: string,
): Promise<CloudResult<{ meta: CloudRunMeta; reportGz: Uint8Array; logGz: Uint8Array }>> {
  if (!cloudConfigured()) return { ok: false, error: 'cloud backup not configured' };
  try {
    const record = await api<CloudRun & { download: TransferTargets }>('GET', `/api/runs/${hash}`);
    const [reportGz, logGz] = await Promise.all([getBlob(record.download, 'report'), getBlob(record.download, 'log')]);
    return { ok: true, value: { meta: record.meta, reportGz, logGz } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function deleteCloudRun(hash: string): Promise<CloudResult<void>> {
  if (!cloudConfigured()) return { ok: false, error: 'cloud backup not configured' };
  try {
    await api<unknown>('DELETE', `/api/runs/${hash}`);
    return { ok: true, value: undefined };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
