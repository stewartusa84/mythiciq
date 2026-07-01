// Desktop live raid-pull feed (runes singleton). The companion carves each completed raid boss pull
// (ENCOUNTER_START..END, wipe or kill) and surfaces it here, grouped by boss, so a raid leader can
// review mechanics between pulls. Session-only — the pulls themselves are saved to local History
// (carves are imported on completion); `hash` is the History key, so clicking a pull re-opens it.
// Inert on the web (no carving happens there).

/** A completed raid boss pull surfaced in the raid review switcher. `hash` is its History key (and unique id).
 *  `success` = kill (true) / wipe (false). Fields come from the PARSED report's boss bucket. */
export type RaidPull = {
  hash: string;
  /** Encounter id — the boss-grouping key. */
  encounterId: number;
  bossName: string;
  /** Raid difficulty label (e.g. 'Heroic'), if known. */
  difficultyName: string | null;
  /** True = boss kill, false = wipe. */
  success: boolean;
  durationMs: number | null;
  /** Arrival time (epoch ms). */
  at: number;
  /** Counted in the feed's unread badge until the dropdown is opened. */
  seen: boolean;
};
/** The fields a carved pull contributes (everything but the bookkeeping). */
export type RaidPullInput = Omit<RaidPull, 'at' | 'seen'>;

/** All attempts at one boss, grouped for the feed — the live counterpart of `raidBosses.ts`'s
 *  `BossBucket`, built from the session's pull list. Attempts are newest-first within a boss. */
export type PullGroup = {
  encounterId: number;
  bossName: string;
  difficultyName: string | null;
  pulls: RaidPull[];
  kills: number;
  wipes: number;
};

/** Cap on retained pulls this session — a raid night can be long, but the feed is a recent peek. */
const MAX_PULLS = 60;

class RaidPullStore {
  /** Completed raid pulls this session (newest first). */
  pulls = $state<RaidPull[]>([]);

  /** Surface a completed pull. Deduped by hash (a re-carve moves it to the front, re-marked unseen);
   *  capped to the most recent few. */
  addPull(p: RaidPullInput, opts: { seen?: boolean } = {}) {
    const without = this.pulls.filter((n) => n.hash !== p.hash);
    this.pulls = [{ ...p, at: Date.now(), seen: opts.seen ?? false }, ...without].slice(0, MAX_PULLS);
  }
  dismiss(hash: string) {
    this.pulls = this.pulls.filter((n) => n.hash !== hash);
  }
  /** Mark every pull read (called when the feed dropdown opens) — clears its share of the badge. */
  markSeen() {
    if (this.pulls.some((n) => !n.seen)) {
      this.pulls = this.pulls.map((n) => (n.seen ? n : { ...n, seen: true }));
    }
  }
  get unseenCount(): number {
    return this.pulls.reduce((n, p) => n + (p.seen ? 0 : 1), 0);
  }

  /** Pulls bucketed by boss, in first-seen order (so the list reads in raid-progression order).
   *  Within a boss, newest attempt first. */
  get grouped(): PullGroup[] {
    const order: number[] = [];
    const byId = new Map<number, PullGroup>();
    // `pulls` is newest-first; iterate oldest-first so first-seen order is progression order, then
    // the per-boss list (rebuilt newest-first below) matches the feed's "latest pull on top".
    for (const p of [...this.pulls].reverse()) {
      let g = byId.get(p.encounterId);
      if (!g) {
        g = { encounterId: p.encounterId, bossName: p.bossName, difficultyName: p.difficultyName, pulls: [], kills: 0, wipes: 0 };
        byId.set(p.encounterId, g);
        order.push(p.encounterId);
      }
      g.pulls.unshift(p); // newest-first within the boss
      if (p.success) g.kills++;
      else g.wipes++;
    }
    return order.map((id) => byId.get(id)!);
  }
}

export const raidPulls = new RaidPullStore();
