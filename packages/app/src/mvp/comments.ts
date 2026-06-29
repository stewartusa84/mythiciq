// Discussion-comments client — the browser side of the backend's /api/shares/:code/comments routes and
// the /api/me/profile handle. All authed (discussion shares are signed-in only). No-ops with an error
// when no backend is configured. Mirrors the share.ts / cloudBackup.ts result style.

import { auth } from './auth.svelte.js';

const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL as string | undefined)?.replace(/\/$/, '');

export interface Comment {
  id: string;
  code: string;
  authorSub: string;
  authorHandle: string;
  body: string;
  atMs?: number;
  parentId?: string;
  reactions?: Record<string, string[]>;
  createdAt: number;
  deletedAt?: number;
}

/** The fixed reaction palette (mirrors the backend's closed set). */
export const REACTIONS = ['👍', '❤️', '😂', '😮', '🎯', '🔥'] as const;

/** Result type; `needsHandle` is set on a 409 so the UI can prompt for a display name before posting. */
export type CommentResult<T> = { ok: true; value: T } | { ok: false; error: string; needsHandle?: boolean };

export function commentsConfigured(): boolean {
  return !!BACKEND_URL && auth.configured;
}

async function authHeaders(json = false): Promise<Record<string, string>> {
  const token = await auth.getAccessToken();
  if (!token) throw new Error('signed out');
  const h: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (json) h['Content-Type'] = 'application/json';
  return h;
}

async function call<T>(method: string, path: string, body?: unknown): Promise<CommentResult<T>> {
  if (!BACKEND_URL) return { ok: false, error: 'no backend configured' };
  try {
    const res = await fetch(`${BACKEND_URL}${path}`, {
      method,
      headers: await authHeaders(body !== undefined),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (res.status === 409) {
      const j = (await res.json().catch(() => ({}))) as { needsHandle?: boolean; error?: string };
      return { ok: false, error: j.error ?? 'conflict', needsHandle: j.needsHandle };
    }
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

/** The signed-in user's display handle (or null if not set yet). */
export function getProfile(): Promise<CommentResult<{ handle: string | null; baseHandle: string | null }>> {
  return call('GET', '/api/me/profile');
}
/** Set/replace the display handle (base handle; server adds the #discriminator). */
export function setHandle(handle: string): Promise<CommentResult<{ handle: string; baseHandle: string }>> {
  return call('PUT', '/api/me/profile', { handle });
}

/** Poll-friendly thread fetch with ETag: returns `same` (304, nothing changed) so polling is cheap. */
export type ThreadFetch =
  | { status: 'ok'; comments: Comment[]; etag: string | null }
  | { status: 'same' }
  | { status: 'error'; error: string; needsAuth?: boolean };

export async function fetchThread(code: string, etag?: string | null): Promise<ThreadFetch> {
  if (!BACKEND_URL) return { status: 'error', error: 'no backend configured' };
  try {
    const headers = await authHeaders();
    if (etag) headers['If-None-Match'] = etag;
    const res = await fetch(`${BACKEND_URL}/api/shares/${code}/comments`, { headers });
    if (res.status === 304) return { status: 'same' };
    if (res.status === 401) return { status: 'error', error: 'sign in required', needsAuth: true };
    if (!res.ok) return { status: 'error', error: `thread ${res.status}` };
    const { comments } = (await res.json()) as { comments: Comment[] };
    return { status: 'ok', comments, etag: res.headers.get('ETag') };
  } catch (e) {
    return { status: 'error', error: e instanceof Error ? e.message : String(e) };
  }
}

export function postComment(code: string, body: string, atMs?: number, parentId?: string): Promise<CommentResult<Comment>> {
  const payload: Record<string, unknown> = { body };
  if (atMs != null) payload.atMs = atMs;
  if (parentId) payload.parentId = parentId;
  return call('POST', `/api/shares/${code}/comments`, payload);
}
export function reactComment(code: string, id: string, emoji: string): Promise<CommentResult<Comment>> {
  return call('POST', `/api/shares/${code}/comments/${id}/react`, { emoji });
}
export function deleteComment(code: string, id: string): Promise<CommentResult<{ deleted: string }>> {
  return call('DELETE', `/api/shares/${code}/comments/${id}`);
}
export function reportComment(code: string, id: string): Promise<CommentResult<{ reported: string }>> {
  return call('POST', `/api/shares/${code}/comments/${id}/report`);
}
/** Owner: open/close the discussion to new comments. */
export function setDiscussionLocked(code: string, locked: boolean): Promise<CommentResult<{ locked: boolean }>> {
  return call('PUT', `/api/shares/${code}/discussion`, { locked });
}
/** Permanently delete the signed-in user's account data (comments, shares, backups, profile). */
export function deleteAccount(): Promise<CommentResult<{ deleted: boolean; commentsRemoved: number; sharesRemoved: number }>> {
  return call('DELETE', '/api/me');
}
