// Group-chat state (runes singleton). Holds one chat CHANNEL per group the signed-in user is in (a Run
// Card whose roster they're on, incl. runs they lead). Chat is LIVE-ONLY: messages arrive over the
// WebSocket (lfgSocket.ts) and are kept in memory for the session — there's no server history, so a page
// reload starts a thread empty. The floating ChatWidget reads this; App keeps the channel list reconciled
// from the board (setGroups) as rosters change.

import type { ChatMessage, RunCardStatus } from './lfg.js';
import { sendChat } from './lfgSocket.js';

const MAX_PER_CHANNEL = 200;

/** A group the user can chat in, plus its session messages + unread count. */
export interface ChatChannel {
  runCardId: string;
  title: string;
  status: RunCardStatus;
  members: number;
  messages: ChatMessage[];
  unread: number;
}

/** The minimal group descriptor App derives from the board to keep the channel list current. */
export interface GroupDescriptor {
  runCardId: string;
  title: string;
  status: RunCardStatus;
  members: number;
}

class LfgChat {
  channels = $state<ChatChannel[]>([]);
  /** Is the floating window expanded? */
  isOpen = $state(false);
  /** The channel currently shown (null ⇒ the channel list / none). */
  activeId = $state<string | null>(null);

  /** Reconcile the known channels from the board: add new groups, refresh title/status/members on
   *  surviving ones (KEEPING their messages + unread), drop channels for groups the user left. */
  setGroups(groups: GroupDescriptor[]): void {
    const byId = new Map(this.channels.map((c) => [c.runCardId, c]));
    this.channels = groups.map((g) => {
      const existing = byId.get(g.runCardId);
      return existing
        ? { ...existing, title: g.title, status: g.status, members: g.members }
        : { runCardId: g.runCardId, title: g.title, status: g.status, members: g.members, messages: [], unread: 0 };
    });
    // If the active channel vanished, fall back to the first (or none).
    if (this.activeId && !this.channels.some((c) => c.runCardId === this.activeId)) {
      this.activeId = this.channels[0]?.runCardId ?? null;
    }
  }

  /** A live message arrived. Append (dedup by id); bump unread unless it's the open, active channel. */
  receive(message: ChatMessage): void {
    const idx = this.channels.findIndex((c) => c.runCardId === message.runCardId);
    const c = this.channels[idx];
    if (!c) return; // not a known group yet — history will include it once the board refetches
    if (c.messages.some((m) => m.id === message.id)) return;
    const isActive = this.isOpen && this.activeId === message.runCardId;
    this.#replace(idx, {
      ...c,
      messages: [...c.messages, message].slice(-MAX_PER_CHANNEL),
      unread: isActive ? 0 : c.unread + 1,
    });
  }

  /** Send a message over the socket. Returns false if the socket isn't open (caller shows "reconnecting"). */
  send(runCardId: string, body: string): boolean {
    const text = body.trim();
    if (!text) return false;
    return sendChat(runCardId, text);
  }

  open(runCardId?: string): void {
    this.isOpen = true;
    if (runCardId) this.select(runCardId);
    else if (!this.activeId) this.activeId = this.channels[0]?.runCardId ?? null;
    if (this.activeId) this.markRead(this.activeId);
  }
  close(): void {
    this.isOpen = false;
  }
  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }
  /** Show the channel list (back out of a single conversation) without collapsing the widget. */
  showList(): void {
    this.activeId = null;
  }
  select(runCardId: string): void {
    this.activeId = runCardId;
    this.markRead(runCardId);
  }

  markRead(runCardId: string): void {
    const idx = this.channels.findIndex((c) => c.runCardId === runCardId);
    const c = this.channels[idx];
    if (!c || c.unread === 0) return;
    this.#replace(idx, { ...c, unread: 0 });
  }

  get totalUnread(): number {
    return this.channels.reduce((n, c) => n + c.unread, 0);
  }
  get activeChannel(): ChatChannel | null {
    return this.channels.find((c) => c.runCardId === this.activeId) ?? null;
  }

  #replace(idx: number, channel: ChatChannel): void {
    this.channels = [...this.channels.slice(0, idx), channel, ...this.channels.slice(idx + 1)];
  }
}

export const lfgChat = new LfgChat();
