// User settings singleton (runes in `.svelte.ts`, persisted to localStorage). Currently: opt-in for
// sharing ANONYMIZED run stats with the backend to get comparison feedback. OFF by default — nothing
// leaves the browser until the user explicitly turns it on. `madeChoice` records whether the user has
// ever opened settings / made a decision, so the first-time "you can opt in" tooltip shows only once.

import { latestChangeId } from './changelog.js';

const KEY = 'wow.settings.v1';

/** A dungeon's best timed run so far. "Best" = highest key level, then most stars, then fastest time. */
export interface PersonalBest {
  keyLevel: number;
  stars: number;
  /** Completion time (ms). 0 when unknown — then only key level + stars are comparable. */
  timeMs: number;
}

/** Strictly-better ordering for personal bests: higher key beats lower; at the same key, more stars
 *  beats fewer; tie on stars, faster time wins. Equal/incomparable ⇒ not strictly better (no false PB). */
export function isBetterRun(a: PersonalBest, b: PersonalBest): boolean {
  if (a.keyLevel !== b.keyLevel) return a.keyLevel > b.keyLevel;
  if (a.stars !== b.stars) return a.stars > b.stars;
  if (a.timeMs > 0 && b.timeMs > 0) return a.timeMs < b.timeMs;
  return false;
}

interface Persisted {
  shareStats: boolean;
  anonymizeShared: boolean;
  /** Opt-in: upload the COMPRESSED carved run to our backend so we re-parse it server-side and award
   *  "verified credit" (a clean verdict + praise) to the verified party members. This is the ONLY feature
   *  that sends the actual combat log off-device. OFF by default. */
  verifiedCredit: boolean;
  madeChoice: boolean;
  /** Id of the newest changelog entry the user has seen (opened the Notifications bell while it was current). */
  seenChangelogId: string | null;
  /** Notification ids the user has dismissed from the bell dropdown (so they don't resurface). */
  dismissedNotifications: string[];
  /** Width (px) of the fold-out analysis sidebar — a per-client layout preference (monitor/browser). */
  panelWidth: number;
  /** Whether the first-run guided walkthrough has been shown/dismissed (so it only auto-runs once). */
  tourSeen: boolean;
  /** Desktop only: max runs to retain in the on-disk history folder (auto-pruned, newest by play-time). */
  historyCap: number;
  /** Desktop raid review: auto-open a carved raid pull into the replay viewer when it was a WIPE, so a
   *  leader can scrub mechanics hands-free between pulls. Off by default (kills stay click-to-open). */
  autoOpenWipe: boolean;
  /** Desktop low-resource mode: a few seconds after the window is minimized to the tray, unload the
   *  webview UI to free its memory (the native log watcher keeps running); restoring from the tray
   *  rebuilds it. Off by default. */
  lowResourceMode: boolean;
  /** Replay: compact player cards (narrower, icon-only auras) for limited screen real estate. */
  compactReplay: boolean;
  /** Replay: show minor / misc buffs in the player panes (off ⇒ collapsed to a `⋯N` count). */
  replayShowMisc: boolean;
  /** Replay: spell ids HIDDEN from every player's combat journal (the journal-filter selection). */
  journalHiddenSpells: number[];
  /** Play a short chime with the "Timed!" celebration on a timed run. */
  celebrationSound: boolean;
  /** Run hashes whose "Timed!" celebration has already played — so it fires once ever per run, not on
   *  every app open / replay. Capped (oldest dropped) to stay bounded. */
  celebratedRuns: string[];
  /** Best timed run per dungeon (keyed by challengeModeId/mapId/name) — drives the "Personal Best!"
   *  celebration. */
  personalBests: Record<string, PersonalBest>;
}

const DEFAULTS: Persisted = { shareStats: false, anonymizeShared: true, verifiedCredit: false, madeChoice: false, seenChangelogId: null, dismissedNotifications: [], panelWidth: 540, tourSeen: false, historyCap: 100, autoOpenWipe: false, lowResourceMode: false, compactReplay: false, replayShowMisc: false, journalHiddenSpells: [], celebrationSound: false, celebratedRuns: [], personalBests: {} };

/** Cap on remembered celebrated-run hashes — plenty to cover a user's local history without unbounded growth. */
const MAX_CELEBRATED = 300;

function load(): Persisted {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Persisted>) } : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

class Settings {
  /** Share name-free run stats with the backend to receive comparison feedback. */
  shareStats = $state(DEFAULTS.shareStats);
  /** When sharing, strip the log owner's spec + personal numbers (only contribute raid-level data). */
  anonymizeShared = $state(DEFAULTS.anonymizeShared);
  /** Opt-in: upload the compressed carved run for server-side "verified credit" (off by default). */
  verifiedCredit = $state(DEFAULTS.verifiedCredit);
  /** Whether the user has ever made an explicit choice (opened settings) — gates the first-time hint. */
  madeChoice = $state(DEFAULTS.madeChoice);
  /** Newest changelog entry the user has seen — drives the Notifications-bell unread badge. */
  seenChangelogId = $state(DEFAULTS.seenChangelogId);
  /** Notification ids dismissed from the bell dropdown (so they don't resurface). */
  dismissedNotifications = $state<string[]>(DEFAULTS.dismissedNotifications);
  /** Persisted width of the fold-out analysis sidebar (per-client layout preference). */
  panelWidth = $state(DEFAULTS.panelWidth);
  /** Whether the first-run walkthrough has been shown — gates the one-time auto-run. */
  tourSeen = $state(DEFAULTS.tourSeen);
  /** Desktop on-disk history retention cap (runs). Ignored on the web (IndexedDB uses MAX_RUNS). */
  historyCap = $state(DEFAULTS.historyCap);
  /** Desktop raid review: auto-open a wiped raid pull into the replay viewer (off by default). */
  autoOpenWipe = $state(DEFAULTS.autoOpenWipe);
  /** Desktop low-resource mode: unload the webview UI shortly after minimizing to the tray (off by default). */
  lowResourceMode = $state(DEFAULTS.lowResourceMode);
  /** Replay compact-cards mode (narrower cards, icon-only auras). */
  compactReplay = $state(DEFAULTS.compactReplay);
  /** Replay: show minor/misc buffs in the player panes. */
  replayShowMisc = $state(DEFAULTS.replayShowMisc);
  /** Replay: spell ids hidden from every player's combat journal (persisted journal-filter selection). */
  journalHiddenSpells = $state<number[]>(DEFAULTS.journalHiddenSpells);
  /** Play a short chime with the "Timed!" celebration. */
  celebrationSound = $state(DEFAULTS.celebrationSound);
  /** Run hashes whose timed-run celebration has already played (fire-once-ever, persisted). */
  celebratedRuns = $state<string[]>(DEFAULTS.celebratedRuns);
  /** Best timed run per dungeon (drives the "Personal Best!" celebration). */
  personalBests = $state<Record<string, PersonalBest>>(DEFAULTS.personalBests);

  constructor() {
    const p = load();
    this.shareStats = p.shareStats;
    this.anonymizeShared = p.anonymizeShared;
    this.verifiedCredit = p.verifiedCredit;
    this.madeChoice = p.madeChoice;
    this.seenChangelogId = p.seenChangelogId;
    this.dismissedNotifications = Array.isArray(p.dismissedNotifications) ? p.dismissedNotifications : [];
    this.panelWidth = p.panelWidth;
    this.tourSeen = p.tourSeen;
    this.historyCap = p.historyCap;
    this.autoOpenWipe = p.autoOpenWipe;
    this.lowResourceMode = p.lowResourceMode;
    this.compactReplay = p.compactReplay;
    this.replayShowMisc = p.replayShowMisc;
    this.journalHiddenSpells = Array.isArray(p.journalHiddenSpells) ? p.journalHiddenSpells : [];
    this.celebrationSound = p.celebrationSound;
    this.celebratedRuns = Array.isArray(p.celebratedRuns) ? p.celebratedRuns : [];
    this.personalBests = p.personalBests && typeof p.personalBests === 'object' ? p.personalBests : {};
  }

  private persist(): void {
    try {
      localStorage.setItem(
        KEY,
        JSON.stringify({
          shareStats: this.shareStats,
          anonymizeShared: this.anonymizeShared,
          verifiedCredit: this.verifiedCredit,
          madeChoice: this.madeChoice,
          seenChangelogId: this.seenChangelogId,
          dismissedNotifications: this.dismissedNotifications,
          panelWidth: this.panelWidth,
          tourSeen: this.tourSeen,
          historyCap: this.historyCap,
          autoOpenWipe: this.autoOpenWipe,
          lowResourceMode: this.lowResourceMode,
          compactReplay: this.compactReplay,
          replayShowMisc: this.replayShowMisc,
          journalHiddenSpells: this.journalHiddenSpells,
          celebrationSound: this.celebrationSound,
          celebratedRuns: this.celebratedRuns,
          personalBests: this.personalBests,
        }),
      );
    } catch {
      /* quota / unavailable — keep the in-memory state */
    }
  }

  /** Mark the changelog read up to the newest entry (clears the bell's unread badge). */
  markChangelogSeen(): void {
    const latest = latestChangeId() ?? null;
    if (this.seenChangelogId !== latest) {
      this.seenChangelogId = latest;
      this.persist();
    }
  }

  /** Dismiss a notification card from the bell dropdown so it doesn't resurface. */
  dismissNotification(id: string): void {
    if (this.dismissedNotifications.includes(id)) return;
    this.dismissedNotifications = [...this.dismissedNotifications, id];
    this.persist();
  }

  setShareStats(v: boolean): void {
    this.shareStats = v;
    this.markChoiceMade();
    this.persist();
  }
  setAnonymize(v: boolean): void {
    this.anonymizeShared = v;
    this.persist();
  }
  /** Opt into / out of uploading the compressed carved run for server-side verified credit. */
  setVerifiedCredit(v: boolean): void {
    this.verifiedCredit = v;
    this.markChoiceMade();
    this.persist();
  }
  /** Persist the sidebar width (called on resize release, not on every drag frame). */
  setPanelWidth(px: number): void {
    this.panelWidth = px;
    this.persist();
  }
  /** Replay compact-cards mode. */
  setCompactReplay(v: boolean): void {
    this.compactReplay = v;
    this.persist();
  }
  /** Replay misc-buff visibility. */
  setReplayShowMisc(v: boolean): void {
    this.replayShowMisc = v;
    this.persist();
  }
  /** Celebration chime on/off. */
  setCelebrationSound(v: boolean): void {
    this.celebrationSound = v;
    this.persist();
  }
  /** Has this run's timed celebration already played (across app opens)? */
  hasCelebrated(hash: string): boolean {
    return this.celebratedRuns.includes(hash);
  }
  /** Record that a run's timed celebration played, so it won't fire again. Caps + drops oldest. */
  markCelebrated(hash: string): void {
    if (this.celebratedRuns.includes(hash)) return;
    const next = [...this.celebratedRuns, hash];
    this.celebratedRuns = next.length > MAX_CELEBRATED ? next.slice(next.length - MAX_CELEBRATED) : next;
    this.persist();
  }
  /** DEV: forget all celebrated runs so the "Timed!" bling can be re-tested. */
  resetCelebrations(): void {
    this.celebratedRuns = [];
    this.persist();
  }
  /** The recorded best timed run for a dungeon, if any. */
  personalBestFor(key: string): PersonalBest | undefined {
    return this.personalBests[key];
  }
  /** Record a timed run as the dungeon's best if it beats the stored one (or there's none yet).
   *  Returns true when it set a NEW personal best (drives the "Personal Best!" celebration). */
  recordPersonalBest(key: string, run: PersonalBest): boolean {
    const prev = this.personalBests[key];
    if (prev && !isBetterRun(run, prev)) return false;
    this.personalBests = { ...this.personalBests, [key]: run };
    this.persist();
    return true;
  }
  /** DEV: forget all personal bests so the "Personal Best!" celebration can be re-tested. */
  resetPersonalBests(): void {
    this.personalBests = {};
    this.persist();
  }
  /** Replay journal-filter: the set of spell ids hidden from every player's combat journal. */
  setJournalHiddenSpells(ids: Iterable<number>): void {
    this.journalHiddenSpells = [...ids];
    this.persist();
  }
  /** Desktop raid review: auto-open a wiped raid pull into replay. */
  setAutoOpenWipe(v: boolean): void {
    this.autoOpenWipe = v;
    this.persist();
  }
  /** Desktop low-resource mode: unload the webview UI shortly after minimizing to the tray. */
  setLowResourceMode(v: boolean): void {
    this.lowResourceMode = v;
    this.persist();
  }
  /** Desktop history retention cap (clamped to a sane range). */
  setHistoryCap(n: number): void {
    const v = Math.round(n);
    this.historyCap = Number.isFinite(v) ? Math.min(2000, Math.max(5, v)) : DEFAULTS.historyCap;
    this.persist();
  }
  /** Called when the user opens settings — dismisses the first-time hint for good. */
  markChoiceMade(): void {
    if (!this.madeChoice) {
      this.madeChoice = true;
      this.persist();
    }
  }
  /** Mark the first-run walkthrough done (finished or skipped) so it won't auto-run again. */
  markTourSeen(): void {
    if (!this.tourSeen) {
      this.tourSeen = true;
      this.persist();
    }
  }
  /** Re-arm the walkthrough so it can be replayed (e.g. a "Replay walkthrough" button in Settings). */
  resetTour(): void {
    this.tourSeen = false;
    this.persist();
  }
}

export const settings = new Settings();
