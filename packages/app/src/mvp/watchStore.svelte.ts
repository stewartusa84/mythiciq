// Desktop live-watch UI state (runes singleton). Holds only persistent/display state — the actual
// event handling + parse orchestration lives in App.svelte where `onFile` is in scope. Inert on the
// web (no Tauri), where `available` is false and nothing renders.

import { isDesktop } from './desktop';
import type { RunResult } from './report';

const DIR_KEY = 'mythiciq.watch.dir';
/** Cap on retained run notifications — the bell is a recent-activity peek, not an archive. */
const MAX_RUN_NOTIFICATIONS = 12;

/** A completed carved run, surfaced as a card on the notifications bell. The run is already saved to
 *  local history (carves are imported on completion); `hash` is its history key (and the card's unique
 *  id), so clicking the card re-opens it from history. `result`/`stars` come from the parsed report
 *  (`runResult`) — NOT the native quick-parse `success` flag, which conflates timed vs over-time. */
export type RunNotification = {
  hash: string;
  dungeon: string | null;
  level: number | null;
  result: RunResult;
  stars: number;
  durationMs: number | null;
  /** Arrival time (epoch ms). */
  at: number;
  /** Counted in the bell's unread badge until the dropdown is opened. */
  seen: boolean;
};
/** The headline fields a carved run contributes to a notification (everything but the bookkeeping). */
export type RunNotificationInput = Omit<RunNotification, 'at' | 'seen'>;

class WatchStore {
  /** Running inside the Tauri desktop shell (vs a plain browser). */
  available = $state(isDesktop());
  /** Actively watching a folder. */
  watching = $state(false);
  /** Initial backfill scan in progress. */
  scanning = $state(false);
  /** The watched folder (persisted across launches). */
  dir = $state<string | null>(readDir());
  /** Completed carved runs surfaced as cards on the notifications bell (newest first, session-only —
   *  the runs themselves live in History). */
  runNotifications = $state<RunNotification[]>([]);

  /** Surface a completed carved run on the bell. Deduped by hash (a re-carve moves it to the front and
   *  re-marks it unseen); capped to the most recent few. */
  addRun(r: RunNotificationInput) {
    const without = this.runNotifications.filter((n) => n.hash !== r.hash);
    this.runNotifications = [{ ...r, at: Date.now(), seen: false }, ...without].slice(0, MAX_RUN_NOTIFICATIONS);
  }
  dismissRun(hash: string) {
    this.runNotifications = this.runNotifications.filter((n) => n.hash !== hash);
  }
  /** Mark all run cards read (called when the bell dropdown opens) — clears their share of the badge. */
  markRunsSeen() {
    if (this.runNotifications.some((n) => !n.seen)) {
      this.runNotifications = this.runNotifications.map((n) => (n.seen ? n : { ...n, seen: true }));
    }
  }
  get unseenRunCount(): number {
    return this.runNotifications.reduce((n, r) => n + (r.seen ? 0 : 1), 0);
  }

  setDir(d: string | null) {
    this.dir = d;
    try {
      if (d) localStorage.setItem(DIR_KEY, d);
      else localStorage.removeItem(DIR_KEY);
    } catch {
      /* private mode — fine, just not remembered */
    }
  }
}

function readDir(): string | null {
  try {
    return localStorage.getItem(DIR_KEY);
  } catch {
    return null;
  }
}

export const watch = new WatchStore();
