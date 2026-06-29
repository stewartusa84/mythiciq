// Shareable replay links — the browser side of the backend's /api/shares routes. Minting/revoking/
// listing are authed (the owner). VIEWING a `public` share needs no account; a `signed-in` (discussion)
// share requires a token, so `fetchShare` takes one and surfaces `needsAuth` on a 401 for the gate.
//
// Two share kinds:
//  - Default (public): BACKS THE RUN UP to the cloud (reusing cloudBackup.backupRun — the share just
//    exposes those blobs) then mints a code. Shows REAL player names.
//  - Anonymized (opts.anonymize): rewrites the sub-log locally (anonymizeRunLog) so no real name leaves
//    the browser, uploads that name-free blob to a share-scoped key, and mints a signed-in discussion
//    share. The real run is NOT uploaded.

import type { RosterEntry } from '@wow/engine';
import { auth } from './auth.svelte.js';
import { backupRun, type CloudRunMeta } from './cloudBackup.js';
import { loadRunBytes, loadRunReportBytes, loadRunReport, gzip, gunzip } from './history.js';
import { anonymizeRunLog } from './anonymizeLog.js';
import { isDesktop } from './desktop.js';

const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL as string | undefined)?.replace(/\/$/, '');
// Public web origin that serves the /r/<code> viewer. On desktop window.location is the Tauri origin
// (not shareable), so the link must point at the deployed web app — configurable, default the prod domain.
const PUBLIC_BASE = (
  (import.meta.env.VITE_PUBLIC_BASE_URL as string | undefined) ??
  (isDesktop() ? 'https://mythiciq.app' : typeof window !== 'undefined' ? window.location.origin : '')
).replace(/\/$/, '');

export type ShareResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** A share as the owner lists it. */
export interface MyShare {
  code: string;
  ownerSub: string;
  hash: string;
  createdAt: number;
  meta?: Record<string, unknown>;
}

/** What the viewer needs to open a shared replay. `anonymized` shares carry only a (name-free) log. */
export interface SharedReplayInfo {
  code: string;
  meta: Record<string, unknown> | null;
  createdAt: number;
  visibility: 'public' | 'signed-in';
  discussion: boolean;
  anonymized: boolean;
  locked: boolean;
  viewerIsOwner: boolean;
  reportGz: Uint8Array | null;
  logGz: Uint8Array;
}

/** fetchShare result, with a `needsAuth` signal so the viewer can show a sign-in gate on a 401. */
export type FetchShareResult =
  | { ok: true; value: SharedReplayInfo }
  | { ok: false; error: string; needsAuth?: boolean };

/** Download targets returned by GET /api/shares/:code. `report` is absent for anonymized shares. */
interface ShareDownload {
  mode: 'presigned' | 'direct';
  log: string;
  report?: string;
}

/** Where to upload an anonymized share's log blob (from the mint response). */
interface ShareUpload {
  mode: 'presigned' | 'direct';
  log: string;
}

/** Options for minting a share. `anonymize` publishes a name-free copy (requires the run roster). */
export interface ShareOptions {
  anonymize?: boolean;
  discussion?: boolean;
  roster?: RosterEntry[];
}

/** Sharing is possible (backend + Cognito configured). The user may still be signed out. */
export function shareConfigured(): boolean {
  return !!BACKEND_URL && auth.configured;
}

/** The public link for a code. */
export function shareUrl(code: string): string {
  return `${PUBLIC_BASE}/r/${code}`;
}

async function authHeader(): Promise<Record<string, string>> {
  const token = await auth.getAccessToken();
  if (!token) throw new Error('signed out');
  return { Authorization: `Bearer ${token}` };
}

function resolveUrl(url: string): string {
  return url.startsWith('http') ? url : `${BACKEND_URL}${url}`;
}

/** Upload an anonymized share's log blob to its target — presigned (no auth) or direct (auth header). */
async function putShareLog(upload: ShareUpload, bytes: Uint8Array): Promise<void> {
  const url = resolveUrl(upload.log);
  const headers: Record<string, string> = { 'Content-Type': 'application/gzip' };
  if (upload.mode === 'direct') Object.assign(headers, await authHeader());
  const res = await fetch(url, { method: 'PUT', headers, body: bytes as BodyInit });
  if (!res.ok) throw new Error(`upload log → ${res.status}`);
}

/** Mint (or reuse) a share link for a run. By default it backs the run up and serves it with real
 *  names (the original behavior). With `opts.anonymize`, it instead publishes a name-free copy of the
 *  sub-log (requires `opts.roster`) for a signed-in discussion share — the real run is NOT uploaded. */
export async function createShare(
  hash: string,
  meta: CloudRunMeta,
  opts: ShareOptions = {},
): Promise<ShareResult<{ code: string; url: string }>> {
  if (!shareConfigured()) return { ok: false, error: 'sharing not configured' };
  try {
    if (opts.anonymize) {
      // The roster (guid→name→role) drives the aliases. Caller may pass it; otherwise pull it from the
      // run's cached side-pane report (present for any run saved with the cache).
      const roster = opts.roster ?? (await loadRunReport(hash))?.roster;
      if (!roster || roster.length === 0) {
        return { ok: false, error: 'cannot anonymize this run — re-open it once, then share' };
      }
      const logGz = await loadRunBytes(hash);
      if (!logGz) return { ok: false, error: 'run not found in local history' };
      // Strip player names from the sub-log locally — real names never reach the cloud for this share.
      const anonGz = await gzip(anonymizeRunLog(await gunzip(logGz), roster));
      const res = await fetch(`${BACKEND_URL}/api/runs/${hash}/share`, {
        method: 'POST',
        headers: { ...(await authHeader()), 'Content-Type': 'application/json' },
        body: JSON.stringify({ meta, anonymize: true, discussion: opts.discussion ?? true }),
      });
      if (!res.ok) throw new Error(`share ${res.status}`);
      const { code, upload } = (await res.json()) as { code: string; upload: ShareUpload };
      await putShareLog(upload, anonGz);
      return { ok: true, value: { code, url: shareUrl(code) } };
    }

    const logGz = await loadRunBytes(hash);
    if (!logGz) return { ok: false, error: 'run not found in local history' };
    // report.gz is an optional fast-path for the viewer; synthesize an empty one if a legacy run lacks it.
    const reportGz = (await loadRunReportBytes(hash)) ?? (await gzip(new TextEncoder().encode('{}')));

    const backed = await backupRun(hash, meta, reportGz, logGz);
    if (!backed.ok) return { ok: false, error: `backup failed: ${backed.error}` };

    const res = await fetch(`${BACKEND_URL}/api/runs/${hash}/share`, {
      method: 'POST',
      headers: { ...(await authHeader()), 'Content-Type': 'application/json' },
      body: JSON.stringify({ meta }),
    });
    if (!res.ok) throw new Error(`share ${res.status}`);
    const { code } = (await res.json()) as { code: string };
    return { ok: true, value: { code, url: shareUrl(code) } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function revokeShare(code: string): Promise<ShareResult<void>> {
  if (!shareConfigured()) return { ok: false, error: 'sharing not configured' };
  try {
    const res = await fetch(`${BACKEND_URL}/api/shares/${code}`, { method: 'DELETE', headers: await authHeader() });
    if (!res.ok) throw new Error(`revoke ${res.status}`);
    return { ok: true, value: undefined };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function listMyShares(): Promise<ShareResult<MyShare[]>> {
  if (!shareConfigured()) return { ok: false, error: 'sharing not configured' };
  try {
    const res = await fetch(`${BACKEND_URL}/api/me/shares`, { headers: await authHeader() });
    if (!res.ok) throw new Error(`list ${res.status}`);
    const { shares } = (await res.json()) as { shares: MyShare[] };
    return { ok: true, value: shares };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Resolve a code and download its run blob(s), for the /r/<code> viewer. A `public` share needs no
 *  auth; a `signed-in` (discussion) share requires `token` — a 401 returns `needsAuth` so the viewer
 *  can prompt sign-in. The `token` is also forwarded to the blob fetch in `direct` (local/no-S3) mode. */
export async function fetchShare(code: string, token?: string): Promise<FetchShareResult> {
  if (!BACKEND_URL) return { ok: false, error: 'no backend configured' };
  try {
    const authHeaders: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
    const res = await fetch(`${BACKEND_URL}/api/shares/${code}`, { headers: authHeaders });
    if (res.status === 401) return { ok: false, error: 'Sign in to view this shared run.', needsAuth: true };
    if (res.status === 404) return { ok: false, error: 'this replay link is invalid or was revoked' };
    if (!res.ok) throw new Error(`share ${res.status}`);
    const info = (await res.json()) as {
      meta: Record<string, unknown> | null;
      createdAt: number;
      visibility: 'public' | 'signed-in';
      discussion: boolean;
      anonymized: boolean;
      locked?: boolean;
      viewerIsOwner?: boolean;
      download: ShareDownload;
    };
    // Direct (local) blob GETs are gated like the share, so forward the token; presigned URLs are not.
    const blobHeaders: Record<string, string> = info.download.mode === 'direct' ? authHeaders : {};
    const dl = async (url: string): Promise<Uint8Array> => {
      const r = await fetch(resolveUrl(url), { headers: blobHeaders });
      if (!r.ok) throw new Error(`download → ${r.status}`);
      return new Uint8Array(await r.arrayBuffer());
    };
    const logGz = await dl(info.download.log);
    let reportGz: Uint8Array | null = null;
    if (info.download.report) {
      try {
        reportGz = await dl(info.download.report);
      } catch {
        reportGz = null; // optional fast-path
      }
    }
    return {
      ok: true,
      value: {
        code,
        meta: info.meta,
        createdAt: info.createdAt,
        visibility: info.visibility,
        discussion: info.discussion,
        anonymized: info.anonymized,
        locked: info.locked ?? false,
        viewerIsOwner: info.viewerIsOwner ?? false,
        reportGz,
        logGz,
      },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
