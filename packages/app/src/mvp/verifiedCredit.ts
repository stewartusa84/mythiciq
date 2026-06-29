// Verified-credit client — the browser side of the backend's opt-in /api/verify routes. When the user
// turns on "verified credit" (settings.verifiedCredit), we upload the COMPRESSED carved run (the same gz
// sub-log we keep for history) so the backend can re-parse it server-side and award per-player credit to
// the verified party members. This is the ONLY path that sends the actual combat log off-device, so it's
// strictly opt-in + sign-in-gated.
//
// No-ops (configured:false) unless a backend (VITE_BACKEND_URL) + Cognito (auth.configured) are set AND
// the user is signed in. The gz moves via a presigned S3 URL in prod (its landing fires the verify
// Lambda) or streams through the API locally. Mirrors cloudBackup.ts.

import { auth } from './auth.svelte.js';

const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL as string | undefined)?.replace(/\/$/, '');

/** One persisted credit record as the server returns it (mirrors backend VerifiedCredit). */
export interface VerifiedCreditRecord {
  characterId: string;
  region: string;
  realmSlug: string;
  name: string;
  runHash: string;
  dungeon?: string;
  keyLevel?: number;
  timed: boolean;
  clean: boolean;
  mechanicFailures: number;
  praise: {
    dpsRank: number | null;
    hpsRank: number | null;
    clutchPlays: number;
    livesSaved: number;
    perfectInterrupts: boolean;
    interruptsLanded: number;
    deaths: number;
    avoidableDamage: number;
  };
  recordedAt: number;
}

interface UploadTarget {
  mode: 'presigned' | 'direct';
  log: string;
}

export type VerifyResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** Backend + Cognito configured (the user may still be signed out / opted out). */
export function verifiedCreditConfigured(): boolean {
  return !!BACKEND_URL && auth.configured;
}

async function authHeader(): Promise<Record<string, string>> {
  const token = await auth.getAccessToken();
  if (!token) throw new Error('signed out');
  return { Authorization: `Bearer ${token}` };
}

function resolveUrl(url: string): string {
  return url.startsWith('http') ? url : `${BACKEND_URL}${url}`;
}

/**
 * Upload one carved run's gz for server-side verification. Best-effort + fire-and-forget at the call site;
 * returns a result so callers can log failures. No-op when not configured / signed out.
 */
export async function submitVerifiedRun(hash: string, gz: Uint8Array): Promise<VerifyResult<void>> {
  if (!verifiedCreditConfigured()) return { ok: false, error: 'verified credit not configured' };
  try {
    const res = await fetch(`${BACKEND_URL}/api/verify/runs/${hash}`, { method: 'POST', headers: await authHeader() });
    if (!res.ok) throw new Error(`POST /api/verify/runs/${hash} → ${res.status}`);
    const { upload } = (await res.json()) as { upload: UploadTarget };
    const headers: Record<string, string> = { 'Content-Type': 'application/gzip' };
    if (upload.mode === 'direct') Object.assign(headers, await authHeader());
    const put = await fetch(resolveUrl(upload.log), { method: 'PUT', headers, body: gz as BodyInit });
    if (!put.ok) throw new Error(`upload verify gz → ${put.status}`);
    return { ok: true, value: undefined };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Fetch the signed-in user's verified credit across all their characters (newest first). */
export async function listMyVerifiedCredit(): Promise<VerifyResult<VerifiedCreditRecord[]>> {
  if (!verifiedCreditConfigured()) return { ok: false, error: 'verified credit not configured' };
  try {
    const res = await fetch(`${BACKEND_URL}/api/verify/me`, { headers: await authHeader() });
    if (!res.ok) throw new Error(`GET /api/verify/me → ${res.status}`);
    const { credit } = (await res.json()) as { credit: VerifiedCreditRecord[] };
    return { ok: true, value: credit };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
