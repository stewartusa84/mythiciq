// Notification feed for the topbar bell. Notifications are derived from the curated CHANGELOG: recent
// entries surface as dismissible cards in the bell dropdown, where each can be clicked to jump to the
// relevant part of the app (via its optional `link`) or dismissed if it's purely informational. The
// FULL changelog still lives in Settings → "What's new"; the bell is just the "new since you last
// looked" surface. Read/dismissed state is persisted in settings.svelte.ts.

import { CHANGELOG, type ChangeEntry, type NotificationLink } from './changelog.js';

export type { NotificationLink } from './changelog.js';

/** A single notification card. */
export interface NotificationItem {
  id: string;
  date: string;
  title: string;
  detail?: string;
  /** True for changes the user must know — gets the accent chip + drives the bell's red accent. */
  critical: boolean;
  /** Newer than the user's last-seen marker (drives the unread highlight + bell badge). */
  unread: boolean;
  /** Optional in-app navigation; omitted ⇒ the card is informational (dismiss only). */
  link?: NotificationLink;
}

/** Cap on how many cards the bell shows at once — it's a "what's new" peek, not the full archive
 *  (that's Settings → What's new). Unread entries are newest-first, so the cap never hides an unread one
 *  unless there are more than this many, which only happens for a brand-new install. */
export const MAX_NOTIFICATION_CARDS = 12;

/** Ids of changelog entries newer than the user's last-seen marker (ALL when never seen). */
function unreadChangeIds(seenId: string | null): Set<string> {
  const s = new Set<string>();
  for (const e of CHANGELOG) {
    if (e.id === seenId) break; // reached the last-seen entry; everything from here down is already seen
    s.add(e.id);
  }
  return s;
}

/** The active notification cards: non-dismissed changelog entries, newest first, capped, each tagged
 *  unread (newer than the seen marker) and carrying its optional in-app navigation link. */
export function buildNotifications(seenId: string | null, dismissed: Iterable<string>): NotificationItem[] {
  const dismissedSet = new Set(dismissed);
  const unread = unreadChangeIds(seenId);
  const out: NotificationItem[] = [];
  for (const e of CHANGELOG as ChangeEntry[]) {
    if (dismissedSet.has(e.id)) continue;
    out.push({
      id: e.id,
      date: e.date,
      title: e.title,
      detail: e.detail,
      critical: !!e.critical,
      unread: unread.has(e.id),
      link: e.link,
    });
    if (out.length >= MAX_NOTIFICATION_CARDS) break;
  }
  return out;
}

/** Count of unread, non-dismissed notifications — drives the bell badge. */
export function unreadCount(seenId: string | null, dismissed: Iterable<string>): number {
  const dismissedSet = new Set(dismissed);
  let n = 0;
  for (const id of unreadChangeIds(seenId)) if (!dismissedSet.has(id)) n++;
  return n;
}

/** Any unread, non-dismissed CRITICAL entry — drives the red (vs. neutral) bell accent. */
export function hasUnreadCritical(seenId: string | null, dismissed: Iterable<string>): boolean {
  const dismissedSet = new Set(dismissed);
  for (const e of CHANGELOG) {
    if (e.id === seenId) break;
    if (e.critical && !dismissedSet.has(e.id)) return true;
  }
  return false;
}
