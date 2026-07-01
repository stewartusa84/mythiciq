// Admin client + status singleton. The admin surface (a rail section + AdminView) is shown ONLY to
// users in the Cognito Admin/SuperAdmin groups (plus break-glass server-side sub allowlists) — GET
// /api/me reports `admin` / `superAdmin`.
// Every call here is Bearer-authed and 403s for a non-admin, so the client gate is convenience only;
// the backend is the real authority. No-ops (throw) unless a backend + Cognito are configured and the
// user is signed in — mirrors the cloudBackup / comments seams.
//
// Covers the review queues surfaced in the panel: community mechanic-card edits (approve/reject → live
// overlay, no redeploy), removal discoveries (forget/blocklist), bug reports (triage), and the comment
// moderation queue (remove / block / unblock).

import { auth } from './auth.svelte.js';
import type { MechanicCard } from '@wow/engine';
import type { ProposedCard } from './mechanicEdit.js';

const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL as string | undefined)?.replace(/\/$/, '');

/** Admin sign-in is possible (backend + Cognito configured). The user may still be signed out / non-admin. */
export function adminApiConfigured(): boolean {
  return !!BACKEND_URL && auth.configured;
}

async function api<T>(method: string, path: string, jsonBody?: unknown): Promise<T> {
  if (!BACKEND_URL) throw new Error('No backend configured (set VITE_BACKEND_URL).');
  const token = await auth.getAccessToken();
  if (!token) throw new Error('signed out');
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (jsonBody !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${BACKEND_URL}${path}`, {
    method,
    headers,
    body: jsonBody !== undefined ? JSON.stringify(jsonBody) : undefined,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`${method} ${path} → ${res.status}${detail ? ` — ${detail}` : ''}`);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

// ---- Mechanic-card edit review queue ----------------------------------------------------------

export type EditStatus = 'pending' | 'approved' | 'rejected';

export interface MechanicEditRecord {
  id: string;
  createdAt: string;
  spellId: number;
  dungeon?: string;
  proposed: ProposedCard;
  note?: string;
  submitterSub?: string;
  appVersion?: string;
  status: EditStatus;
  reviewedAt?: string;
}

export interface MechanicEditsResponse {
  total: number;
  records: MechanicEditRecord[];
  /** The CURRENT served card per referenced spell (for the before/after diff). */
  cards: Record<string, MechanicCard>;
  bundleVersion?: string;
}

export const listMechanicEdits = (): Promise<MechanicEditsResponse> =>
  api<MechanicEditsResponse>('GET', '/api/mechanic-edits');

export const reviewMechanicEdit = (id: string, decision: 'approve' | 'reject'): Promise<{ id: string; status: EditStatus; bundleVersion?: string }> =>
  api('POST', `/api/admin/mechanic-edits/${id}/${decision}`);

// ---- Removal discoveries ----------------------------------------------------------------------

export interface DiscoveryRecord {
  removerSpellId: number;
  removerName: string;
  removedSpellId: number;
  removedName: string;
  reason?: string;
  occurrences?: number;
  runIds?: string[];
  recordedAt?: string;
  promoted?: boolean;
  promotedAs?: string;
  via?: 'dispel' | 'immunity';
}

export interface DiscoveriesResponse {
  total: number;
  promoted: number;
  pending: number;
  records: DiscoveryRecord[];
}

export const listDiscoveries = (): Promise<DiscoveriesResponse> =>
  api<DiscoveriesResponse>('GET', '/api/removal-discoveries');

export const forgetDiscovery = (key: string): Promise<{ forgotten: string; blocklisted: boolean }> =>
  api('POST', '/api/admin/forget-discovery', { key });

// ---- Bug reports (triage — metadata only) ------------------------------------------------------

export interface BugReportRecord {
  id: string;
  createdAt: string;
  message: string;
  attachments?: { name?: string; type?: string; bytes?: number }[];
  context?: Record<string, unknown>;
  userAgent?: string;
}

export const listBugReports = (): Promise<{ total: number; records: BugReportRecord[] }> =>
  api('GET', '/api/bug-reports');

// ---- Comment moderation queue -----------------------------------------------------------------

export interface CommentReportRecord {
  code: string;
  id: string;
  reporters?: string[];
  reportedAt?: number;
  comment?: { authorSub?: string; authorHandle?: string; body?: string; deletedAt?: number } | null;
}

export const listCommentReports = (): Promise<{ reports: CommentReportRecord[] }> =>
  api('GET', '/api/admin/comment-reports');

export const removeComment = (code: string, id: string): Promise<{ removed: string }> =>
  api('POST', '/api/admin/comments/remove', { code, id });

export const blockUser = (sub: string): Promise<unknown> => api('POST', '/api/admin/block', { sub });
export const unblockUser = (sub: string): Promise<unknown> => api('POST', '/api/admin/unblock', { sub });

// ---- Cognito user-role management (super-admin only) ---------------------------------------------

export interface AdminUserSummary {
  sub: string;
  username: string;
  email?: string;
  emailVerified?: boolean;
  enabled?: boolean;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
  groups: string[];
  admin: boolean;
  superAdmin: boolean;
}

export interface AdminUsersResponse {
  users: AdminUserSummary[];
  nextToken?: string;
}

export const listAdminUsers = (nextToken?: string): Promise<AdminUsersResponse> =>
  api<AdminUsersResponse>('GET', `/api/admin/users${nextToken ? `?nextToken=${encodeURIComponent(nextToken)}` : ''}`);

export const setAdminUserRoles = (sub: string, roles: { admin?: boolean; superAdmin?: boolean }): Promise<AdminUserSummary> =>
  api<AdminUserSummary>('POST', `/api/admin/users/${encodeURIComponent(sub)}/roles`, roles);

// ---- Admin status singleton -------------------------------------------------------------------

class AdminStatus {
  /** Whether the signed-in user is a backend-authorized admin (drives rail visibility). */
  isAdmin = $state(false);
  /** Whether the signed-in user can manage admin role membership. */
  isSuperAdmin = $state(false);
  /** Whether the backend has an admin auth path configured at all. */
  configured = $state(false);
  #checkedFor: string | null = null;

  /** Resolve admin status for the current session (once per sub). Safe to call repeatedly. */
  async refresh(force = false): Promise<void> {
    if (!adminApiConfigured() || auth.status !== 'signed-in' || !auth.user) {
      this.isAdmin = false;
      this.#checkedFor = null;
      return;
    }
    if (!force && this.#checkedFor === auth.user.sub) return;
    this.#checkedFor = auth.user.sub;
    try {
      const me = await api<{ admin?: boolean; superAdmin?: boolean; adminConfigured?: boolean }>('GET', '/api/me');
      this.isAdmin = !!me.admin;
      this.isSuperAdmin = !!me.superAdmin;
      this.configured = !!me.adminConfigured;
    } catch {
      this.isAdmin = false;
      this.isSuperAdmin = false;
      this.#checkedFor = null; // let a later retry re-check
    }
  }

  reset(): void {
    this.isAdmin = false;
    this.isSuperAdmin = false;
    this.configured = false;
    this.#checkedFor = null;
  }
}

export const admin = new AdminStatus();
