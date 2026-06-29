// LFG near-instant push — the browser WebSocket client. Connects to the API Gateway WebSocket API (the
// access token rides as a `?token=` query param, since browsers can't set headers on a WS handshake),
// listens for `lfg-match` messages, and hands them to a callback. Reconnects with backoff (each reconnect
// fetches a fresh token, so it survives the 1h access-token expiry + API Gateway's idle/duration limits),
// and a light app-level keepalive stays under the ~10-min idle timeout. No-op when `VITE_LFG_WS_URL` is
// unset (local/dev/e2e) or auth isn't configured — the Groups inbox still catches matches on next load.

import { auth } from './auth.svelte.js';
import { lfgConn } from './lfgConn.svelte.js';
import type { ChatMessage, RunCard, RunType } from './lfg.js';

const WS_URL = import.meta.env.VITE_LFG_WS_URL as string | undefined;

/** A broadcast match (a Run Card matching one of your Looking Cards) → surfaces on the bell. */
export interface LfgMatchMessage {
  type: 'lfg-match';
  card: RunCard;
  reason: string;
}

/** A compact run-card snapshot baked onto a board push so the client can render a notification card
 *  (bell + OS toast) without a follow-up fetch. */
export interface LfgCardSummary {
  runType: RunType;
  dungeon: string | null;
  keyLevel: number | null;
  ownerHandle: string | null;
}

/** A change to a run you're involved in → refetch the board AND surface a notification. `roster-full`
 *  fires to the whole roster when the last seat closes (the group is ready to begin). */
export interface LfgBoardMessage {
  type: 'lfg-board';
  event: 'application' | 'application-withdrawn' | 'accepted' | 'declined' | 'run-updated' | 'roster-full' | string;
  runCardId: string;
  /** Present on user-facing events so the client can render the card without a fetch. */
  card?: LfgCardSummary;
}

/** A group-chat message from a run you're in — appended to that group's chat thread (lfgChat). The server
 *  fans every message out to the WHOLE group INCLUDING the author, so the sender renders their own message
 *  on receipt (no optimistic-add dedupe needed). */
export interface LfgChatMessage {
  type: 'lfg-chat';
  message: ChatMessage;
}

export type LfgSocketMessage = LfgMatchMessage | LfgBoardMessage | LfgChatMessage;

let socket: WebSocket | null = null;
let stopped = true;
let retry = 0;
// True while a connect() is mid-flight (between the async token fetch and assigning `socket`). The App
// effect can tear down + restart the socket on any lfgStatus change, so two connect() calls could
// otherwise both pass the `!socket` guard during the awaited token fetch and open TWO sockets — leaving an
// ORPHAN that stays open (pinging + receiving via its captured `ws`) while module `socket` points at the
// other one. That split is exactly how chat SEND silently died while receive kept working (the orphan got
// the frames). This flag serializes connects so only one socket is ever created.
let connecting = false;
let keepalive: ReturnType<typeof setInterval> | null = null;
let onMessage: ((m: LfgSocketMessage) => void) | null = null;

export function lfgSocketConfigured(): boolean {
  return !!WS_URL && auth.configured;
}

export function startLfgSocket(cb: (m: LfgSocketMessage) => void): void {
  if (!lfgSocketConfigured()) return;
  onMessage = cb;
  stopped = false;
  void connect();
}

export function stopLfgSocket(): void {
  stopped = true;
  onMessage = null;
  clearKeepalive();
  lfgConn.setConnected(false);
  try {
    socket?.close();
  } catch {
    /* ignore */
  }
  socket = null;
  retry = 0;
}

async function connect(): Promise<void> {
  if (stopped || socket || connecting) return;
  connecting = true;
  try {
    const token = await auth.getAccessToken();
    // While we awaited the token, the App effect may have stopped us OR a sibling connect may have won.
    // Bail in either case so we never open a second (orphan) socket.
    if (stopped || socket) return;
    if (!token) {
      scheduleReconnect();
      return;
    }
    const ws = new WebSocket(`${WS_URL}?token=${encodeURIComponent(token)}`);
    socket = ws;
    // Every handler below guards on `ws === socket`: once this socket is superseded (a reconnect created a
    // newer one), its stale events must NOT touch module state — otherwise a lingering socket's onclose
    // would clear the LIVE socket's keepalive / flip `connected`, and its onopen would rebind the keepalive
    // to itself. Guarding keeps `socket` (what sendChat uses) and the keepalive on the SAME live socket.
    ws.onopen = () => {
      if (ws !== socket) {
        try {
          ws.close();
        } catch {
          /* stale orphan — discard */
        }
        return;
      }
      // A RECONNECT (retry>0 before we reset it) means we were offline for a window. API Gateway's WS has no
      // offline queue, so any board push (apply/accept/decline/lock/match) sent while we were down is gone,
      // and onopen alone won't reconcile it — bump the board revision so GroupsView refetches AND App
      // re-runs syncLfgGroups (both react to boardRev), self-healing any missed push. Skipped on the FIRST
      // connect (retry===0): the GroupsView mount / sign-in seeding already did that initial fetch.
      const wasReconnect = retry > 0;
      retry = 0;
      lfgConn.setConnected(true);
      if (wasReconnect) lfgConn.bumpBoard();
      // App-level keepalive (every 8 min) so the connection stays under API Gateway's ~10-min idle cutoff.
      clearKeepalive();
      keepalive = setInterval(() => {
        if (ws !== socket) return; // never ping through a superseded socket
        try {
          ws.send(JSON.stringify({ action: 'ping' }));
        } catch {
          /* ignore */
        }
      }, 8 * 60 * 1000);
    };
    ws.onmessage = (ev) => {
      if (ws !== socket) return; // ignore frames on a superseded socket
      try {
        const m = JSON.parse(typeof ev.data === 'string' ? ev.data : '') as LfgSocketMessage;
        if (m?.type === 'lfg-match' && m.card) {
          // A matching run just hit the board — bump the board revision so GroupsView refetches and the new
          // run actually SHOWS UP (the notification card alone wouldn't add it to the board), then surface it.
          lfgConn.bumpBoard();
          onMessage?.(m);
        }
        else if (m?.type === 'lfg-board' && m.runCardId) {
          // Bump the board revision here so GroupsView always refetches, regardless of how the app-level
          // handler chooses to surface it (toast/sound). Then hand it to the handler too.
          lfgConn.bumpBoard();
          onMessage?.(m);
        } else if (m?.type === 'lfg-chat' && (m as LfgChatMessage).message) onMessage?.(m);
      } catch {
        /* ignore non-JSON / unknown frames */
      }
    };
    ws.onclose = () => {
      if (ws !== socket) return; // a superseded socket closing must not disturb the live one
      socket = null;
      lfgConn.setConnected(false);
      clearKeepalive();
      scheduleReconnect();
    };
    ws.onerror = () => {
      try {
        ws.close();
      } catch {
        /* onclose will handle reconnect (when this is the live socket) */
      }
    };
  } catch {
    scheduleReconnect();
  } finally {
    connecting = false;
  }
}

/** Send a group-chat message over the open socket. The server validates membership and fans it back to the
 *  whole group (incl. us, live-only — nothing is persisted) → we render on receipt. Returns false if the
 *  socket isn't open (the caller can surface "reconnecting…"); the message is NOT queued. */
export function sendChat(runCardId: string, body: string): boolean {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    void connect(); // nudge a (re)connect so the user's retry has a live socket; guarded, so it's a no-op when already connecting/connected/stopped
    return false;
  }
  try {
    socket.send(JSON.stringify({ action: 'chat', runCardId, body }));
    return true;
  } catch {
    return false;
  }
}

function scheduleReconnect(): void {
  if (stopped) return;
  const delay = Math.min(30_000, 1000 * 2 ** retry); // 1s,2s,4s… capped at 30s
  retry++;
  setTimeout(() => void connect(), delay);
}

function clearKeepalive(): void {
  if (keepalive) {
    clearInterval(keepalive);
    keepalive = null;
  }
}
