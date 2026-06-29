// Battle.net account-link client — the browser side of /api/blizzard/*. Links the signed-in user's
// Battle.net account so we can pull their WHOLE roster (verified characters) instead of adding them one at
// a time. The OAuth dance is owned by the backend (the client secret can't ship to the browser): we just
// kick it off (start → authorize URL), let Battle.net redirect back, then read + import the roster.
// Mirrors lfg.ts conventions (auth headers, no-op-with-error when no backend / signed out).

import { auth } from './auth.svelte.js';
import { isDesktop, openExternal } from './desktop.js';
import type { Character, Region } from './lfg.js';

const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL as string | undefined)?.replace(/\/$/, '');

/** Sentinel returnTo for desktop: the backend serves a static "done" page (the webview can't ride a web
 *  redirect back) and the client polls /status until the token lands. */
const DESKTOP_RETURN_TO = 'desktop';

export type BlizzardResult<T> = { ok: true; value: T } | { ok: false; error: string };

export function blizzardConfigured(): boolean {
  return !!BACKEND_URL && auth.configured;
}

async function authHeaders(json = false): Promise<Record<string, string>> {
  const token = await auth.getAccessToken();
  if (!token) throw new Error('signed out');
  const h: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (json) h['Content-Type'] = 'application/json';
  return h;
}

async function call<T>(method: string, path: string, body?: unknown): Promise<BlizzardResult<T>> {
  if (!BACKEND_URL) return { ok: false, error: 'no backend configured' };
  try {
    const res = await fetch(`${BACKEND_URL}${path}`, {
      method,
      headers: await authHeaders(body !== undefined),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      return { ok: false, error: j.error ?? `${method} ${path} → ${res.status}` };
    }
    const value = (res.status === 204 ? undefined : await res.json()) as T;
    return { ok: true, value };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export interface BlizzardStatus {
  configured: boolean;
  linked: boolean;
  region?: Region;
  linkedAt?: number;
}

/** A max-level character on the linked account (rich data filled at import). */
export interface AccountCandidate {
  region: Region;
  realm: string;
  realmSlug: string;
  name: string;
  level: number;
  class: string;
  alreadyImported: boolean;
}

export interface AccountRoster {
  linked: boolean;
  /** Set when the stored token expired/was revoked — the user must re-link. */
  needsRelink?: boolean;
  region?: Region;
  maxLevel?: number;
  max?: number;
  slotsLeft?: number;
  candidates?: AccountCandidate[];
}

/** Is the link available + already done? (drives the button: Link vs Re-sync vs Unlink). */
export function blizzardStatus(): Promise<BlizzardResult<BlizzardStatus>> {
  return call('GET', '/api/blizzard/status');
}

/** The linked account's roster (or `{ linked:false }` / `{ needsRelink:true }`). */
export function getBlizzardAccount(): Promise<BlizzardResult<AccountRoster>> {
  return call('GET', '/api/blizzard/account');
}

/** Import the chosen account characters as verified. */
export function importBlizzardCharacters(keys: { realmSlug: string; name: string }[]): Promise<BlizzardResult<{ imported: number; characters: Character[] }>> {
  return call('POST', '/api/blizzard/import', { keys });
}

export function unlinkBlizzard(): Promise<BlizzardResult<{ unlinked: boolean }>> {
  return call('DELETE', '/api/blizzard/link');
}

/**
 * Begin the link. Asks the backend for the authorize URL (state bound to our sub server-side), then:
 *  - WEB (`mode:'redirect'`): navigate the page to Battle.net; it returns to `origin/?bnet=linked` (App
 *    reads + strips it, GroupsView resumes the import).
 *  - DESKTOP (`mode:'poll'`): open the system browser (the webview can't navigate out to Battle.net and
 *    back); the backend stores the token + shows a done page, so the caller polls /status until linked.
 */
export async function startBlizzardLink(region: Region): Promise<BlizzardResult<{ mode: 'redirect' | 'poll' }>> {
  const desktop = isDesktop();
  const returnTo = desktop ? DESKTOP_RETURN_TO : `${window.location.origin}/`;
  const r = await call<{ authorizeUrl: string }>('POST', '/api/blizzard/link/start', { region, returnTo });
  if (!r.ok) return r;
  if (desktop) {
    await openExternal(r.value.authorizeUrl);
    return { ok: true, value: { mode: 'poll' } };
  }
  window.location.assign(r.value.authorizeUrl); // web: leaves the page; resumes via ?bnet=linked
  return { ok: true, value: { mode: 'redirect' } };
}
