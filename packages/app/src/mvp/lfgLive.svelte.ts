// LFG live-match state (runes singleton). Holds the broadcast matches pushed over the WebSocket
// (lfgSocket.ts) so they can surface APP-WIDE on the notifications bell — independent of whether the
// Groups view is open. Session-only (the durable record is the server-side inbox in GET /api/lfg/run-cards);
// this is just the "new since you looked" peek + unseen badge. Mirrors watchStore's runNotifications.

import type { RunType } from './lfg.js';

const MAX = 12;

export interface LfgMatchNote {
  /** The run card id (also the card's unique key — clicking opens Groups). */
  id: string;
  runType: RunType;
  label: string;
  dungeon: string | null;
  keyLevel: number | null;
  ownerHandle: string | null;
  reason: string;
  at: number;
  /** Counted in the bell's unread badge until the dropdown is opened. */
  seen: boolean;
}

export type LfgMatchInput = Omit<LfgMatchNote, 'at' | 'seen'>;

/** A board-event notification (someone applied / you got accepted / declined / run locked / group full).
 *  Presentational — App.svelte computes the icon/title/detail at push time, the bell just renders it. */
export interface LfgEventNote {
  /** Dedupe key (`<runCardId>:<event>`) so each kind shows once per run, latest wins. */
  id: string;
  /** The run card this is about — clicking opens Groups. */
  runCardId: string;
  icon: string;
  title: string;
  detail: string;
  at: number;
  seen: boolean;
}

export type LfgEventInput = Omit<LfgEventNote, 'at' | 'seen'>;

class LfgLive {
  matches = $state<LfgMatchNote[]>([]);
  events = $state<LfgEventNote[]>([]);

  /** Surface a match on the bell. Deduped by run-card id (a re-broadcast moves it to the front, unseen). */
  add(m: LfgMatchInput): void {
    const without = this.matches.filter((n) => n.id !== m.id);
    this.matches = [{ ...m, at: Date.now(), seen: false }, ...without].slice(0, MAX);
  }
  /** Surface a board event on the bell. Deduped by its id (latest of that kind for the run wins). */
  addEvent(e: LfgEventInput): void {
    const without = this.events.filter((n) => n.id !== e.id);
    this.events = [{ ...e, at: Date.now(), seen: false }, ...without].slice(0, MAX);
  }
  dismiss(id: string): void {
    this.matches = this.matches.filter((n) => n.id !== id);
  }
  dismissEvent(id: string): void {
    this.events = this.events.filter((n) => n.id !== id);
  }
  markSeen(): void {
    if (this.matches.some((n) => !n.seen)) {
      this.matches = this.matches.map((n) => (n.seen ? n : { ...n, seen: true }));
    }
    if (this.events.some((n) => !n.seen)) {
      this.events = this.events.map((n) => (n.seen ? n : { ...n, seen: true }));
    }
  }
  get unseen(): number {
    return this.matches.reduce((n, m) => n + (m.seen ? 0 : 1), 0) + this.events.reduce((n, e) => n + (e.seen ? 0 : 1), 0);
  }
}

export const lfgLive = new LfgLive();
