// Group-coordination client — the browser side of the backend's /api/pool + /api/groups routes. All
// authed (account-linked self-signup + a global community pool). No-ops with an error when no backend is
// configured. Mirrors the comments.ts / share.ts result style. SKELETON — see docs/group-coordination.md.

import { auth } from './auth.svelte.js';

const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL as string | undefined)?.replace(/\/$/, '');

export type GroupRole = 'tank' | 'healer' | 'dps';
export const GROUP_ROLES: readonly GroupRole[] = ['tank', 'healer', 'dps'];

/** Composition templates (mirrors the backend's controlled vocab). 'custom' = no constraint. */
export const COMP_TYPES = ['balanced', 'max-buffs', 'melee-cleave', 'ranged-cleave', 'beginner-friendly', 'custom'] as const;
export type CompType = (typeof COMP_TYPES)[number];

export type GroupStatus = 'forming' | 'locked' | 'cancelled';

export type JoinRequestStatus = 'pending' | 'accepted' | 'declined';

export interface JoinRequest {
  groupId: string;
  sub: string;
  handle: string;
  role: GroupRole;
  note?: string;
  status: JoinRequestStatus;
  createdAt: number;
  updatedAt: number;
}

export interface PoolMember {
  sub: string;
  handle: string;
  roles: GroupRole[];
  specIds?: number[];
  note?: string;
  active: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface GroupSlot {
  role: GroupRole;
  memberSub?: string;
  memberHandle?: string;
}

export interface GroupPlan {
  id: string;
  ownerSub: string;
  ownerHandle?: string;
  title: string;
  compType: CompType;
  dungeon?: string;
  keyLevel?: number;
  scheduledAt?: number;
  note?: string;
  slots: GroupSlot[];
  status: GroupStatus;
  createdAt: number;
  updatedAt: number;
}

/** Result type; `needsHandle` is set on a 409 so the UI can prompt for a display name first. */
export type GroupResult<T> = { ok: true; value: T } | { ok: false; error: string; needsHandle?: boolean };

export function groupsConfigured(): boolean {
  return !!BACKEND_URL && auth.configured;
}

async function authHeaders(json = false): Promise<Record<string, string>> {
  const token = await auth.getAccessToken();
  if (!token) throw new Error('signed out');
  const h: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (json) h['Content-Type'] = 'application/json';
  return h;
}

async function call<T>(method: string, path: string, body?: unknown): Promise<GroupResult<T>> {
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

// -- Community pool --
export function listPool(): Promise<GroupResult<{ members: PoolMember[] }>> {
  return call('GET', '/api/pool');
}
export function myPoolEntry(): Promise<GroupResult<{ member: PoolMember | null }>> {
  return call('GET', '/api/pool/me');
}
export function joinPool(input: { roles: GroupRole[]; specIds?: number[]; note?: string; active?: boolean }): Promise<GroupResult<PoolMember>> {
  return call('PUT', '/api/pool/me', input);
}
export function leavePool(): Promise<GroupResult<{ left: boolean }>> {
  return call('DELETE', '/api/pool/me');
}

// -- Group plans --
export function listGroups(): Promise<GroupResult<{
  groups: GroupPlan[];
  mySub: string;
  /** The caller's own request status per group id (so the UI shows requested/accepted/declined). */
  myRequests: Record<string, JoinRequestStatus>;
  /** Pending-request counts for groups the caller OWNS (queue badge). */
  pendingByGroup: Record<string, number>;
}>> {
  return call('GET', '/api/groups');
}
export function getGroup(id: string): Promise<GroupResult<GroupPlan>> {
  return call('GET', `/api/groups/${id}`);
}
export function createGroup(input: {
  title: string;
  compType?: CompType;
  dungeon?: string;
  keyLevel?: number;
  scheduledAt?: number;
  note?: string;
  roles?: GroupRole[];
}): Promise<GroupResult<GroupPlan>> {
  return call('POST', '/api/groups', input);
}
export function updateGroup(
  id: string,
  patch: { title?: string; compType?: CompType; dungeon?: string; keyLevel?: number; scheduledAt?: number; note?: string; status?: GroupStatus },
): Promise<GroupResult<GroupPlan>> {
  return call('PUT', `/api/groups/${id}`, patch);
}
export function deleteGroup(id: string): Promise<GroupResult<{ deleted: string }>> {
  return call('DELETE', `/api/groups/${id}`);
}
export function assignSlot(id: string, slotIndex: number, memberSub: string): Promise<GroupResult<GroupPlan>> {
  return call('POST', `/api/groups/${id}/assign`, { slotIndex, memberSub });
}
export function unassignSlot(id: string, slotIndex: number): Promise<GroupResult<GroupPlan>> {
  return call('DELETE', `/api/groups/${id}/slots/${slotIndex}`);
}

// -- Join requests (player-initiated) --
/** Ask to fill a role in a group. The organizer accepts (→ assigned) or declines. */
export function requestJoin(id: string, role: GroupRole, note?: string): Promise<GroupResult<JoinRequest>> {
  return call('POST', `/api/groups/${id}/requests`, { role, ...(note ? { note } : {}) });
}
export function withdrawRequest(id: string): Promise<GroupResult<{ withdrawn: boolean }>> {
  return call('DELETE', `/api/groups/${id}/requests/me`);
}
/** Owner-only: the request queue for a group. */
export function listRequests(id: string): Promise<GroupResult<{ requests: JoinRequest[] }>> {
  return call('GET', `/api/groups/${id}/requests`);
}
export function acceptRequest(id: string, memberSub: string): Promise<GroupResult<GroupPlan>> {
  return call('POST', `/api/groups/${id}/requests/${memberSub}/accept`);
}
export function declineRequest(id: string, memberSub: string): Promise<GroupResult<JoinRequest>> {
  return call('POST', `/api/groups/${id}/requests/${memberSub}/decline`);
}
