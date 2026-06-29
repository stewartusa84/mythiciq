// LFG presence state (runes singleton). Tracks whether the signed-in user is "active" in Group Finder,
// so (a) the topbar companion-status dot reflects it and (b) App decides whether to hold the push socket
// open. Two reasons to be active: you're LOOKING (≥1 non-expired Looking Card) OR you OWN AN OPEN RUN
// CARD (so a leader receives application pushes even when not looking). GroupsView keeps both in sync as
// cards/runs load and mutate; App.svelte seeds them once on sign-in. Session-only — the durable record
// is the server-side pool/board.

class LfgStatus {
  /** Count of the user's own non-expired Looking Cards. >0 ⇒ "actively looking". */
  activeCards = $state(0);
  /** Does the user own at least one OPEN Run Card? (Such a leader must stay connected for app pushes.) */
  ownsOpenRun = $state(false);
  /** Count of groups (Run Card rosters) the user is a member of — they must stay connected for GROUP CHAT
   *  even when not looking and not owning an open run. */
  inGroups = $state(0);
  /** Epoch ms when the user's SOONEST-expiring active Looking Card lapses (null when not looking). Drives
   *  the "still looking?" inactivity prompt — we nudge a few minutes before this, and if unanswered the
   *  card TTL drops them from the pool. */
  soonestCardExpiry = $state<number | null>(null);

  /** True ⇒ the status dot should show looking-state, and App should keep the WS open. */
  get active(): boolean {
    return this.activeCards > 0 || this.ownsOpenRun || this.inGroups > 0;
  }

  /** True ⇒ the user is "looking" (drives the topbar dot's looking colour, distinct from merely chatting). */
  get looking(): boolean {
    return this.activeCards > 0 || this.ownsOpenRun;
  }

  setActiveCards(n: number): void {
    if (this.activeCards !== n) this.activeCards = n;
  }
  setOwnsOpenRun(v: boolean): void {
    if (this.ownsOpenRun !== v) this.ownsOpenRun = v;
  }
  setInGroups(n: number): void {
    if (this.inGroups !== n) this.inGroups = n;
  }
  setSoonestCardExpiry(ms: number | null): void {
    if (this.soonestCardExpiry !== ms) this.soonestCardExpiry = ms;
  }
}

export const lfgStatus = new LfgStatus();
