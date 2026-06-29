// LFG WebSocket-derived reactive state (runes singleton). Two signals the rest of the app reads:
//  • `connected` — is the push socket live right now? Drives the Group Finder status dot (looking +
//    connected = green, looking + disconnected = red) so a degraded push channel is visible.
//  • `boardRev` — a monotonically-increasing counter bumped on every `lfg-board` push (an application,
//    accept, decline, or lock affecting the user). GroupsView watches it and refetches the board, so a
//    leader's queue / an applicant's status go live without a manual refresh.
// lfgSocket.ts (a plain module) writes these; writing a rune source from anywhere is reactive.

class LfgConn {
  connected = $state(false);
  boardRev = $state(0);

  setConnected(v: boolean): void {
    if (this.connected !== v) this.connected = v;
  }
  bumpBoard(): void {
    this.boardRev++;
  }
}

export const lfgConn = new LfgConn();
