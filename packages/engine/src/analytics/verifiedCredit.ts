// Verified-credit computation — the SERVER-SIDE per-player verdict behind the "verified credit" feature.
//
// Unlike the browser's self-reported clean-run signal (app/src/mvp/cleanRun.ts, which scores only the
// OWNER and never leaves the browser), this runs on the BACKEND over a freshly re-parsed carved run and
// scores EVERY party player: a clean signal (`timed` + `mechanicFailures`) PLUS positive "praise"
// highlights (dps/hps rank, clutch plays, perfect interrupts, deaths, avoidable damage). The backend then
// resolves each player's `Name-Realm` to a verified character and writes the credit (see
// backend/src/verifiedCredit.ts / verifiedCreditStore.ts).
//
// What "verified" actually means: WE compute the numbers from the real event stream rather than trusting a
// self-report. It is NOT tamper-proof — WoW combat logs are editable plain text — so call it
// "server-verified", not "Blizzard-signed". The CLEAN THRESHOLD stays authoritative on the backend (it
// applies the cap via isCleanRun), exactly like the self-reported path; this module returns only the raw
// signal so there is one source of truth for the cap.

import type { ColumnStore } from '../columns/columnStore.js';
import type { Segment } from '../segments/segmenter.js';
import type { SpellTable } from '../spells/spellTable.js';
import { AnalyticsRegistry } from './registry.js';
import { seedAnalytics } from './seed/index.js';
import type { AnalyticContext } from './types.js';
import { segmentRuns } from '../segments/runs.js';
import { buildRoster } from './roster.js';
import type { PlayerRole } from '../spells/specIds.js';
import type { DamageResult } from './seed/damage.js';
import type { HealingResult } from './seed/healing.js';
import type { ClutchResult } from './seed/clutchPlays.js';
import type { InterruptAccountabilityResult } from './seed/interruptAccountability.js';
import type { AvoidableDamageResult } from './seed/avoidableDamage.js';
import type { DeathRecapResult } from './seed/deathRecap.js';

/** Positive, scannable highlights for one player in one verified run. */
export interface PlayerPraise {
  /** 1-based DPS rank among the party (by total damage); null when the player did no damage. */
  dpsRank: number | null;
  /** 1-based HPS rank among the party (by effective healing); null when the player did no healing. */
  hpsRank: number | null;
  /** High-value external/utility casts that helped an ally survive (utility.clutch byCaster). */
  clutchPlays: number;
  /** Of those, how many were at-the-brink life-savers. */
  livesSaved: number;
  /** Kicked ≥1 dangerous cast AND never let a kickable dangerous cast go off. */
  perfectInterrupts: boolean;
  /** Dangerous interruptible casts the player kicked. */
  interruptsLanded: number;
  /** The player's deaths in the run. */
  deaths: number;
  /** Total avoidable-mechanic damage the player ate (KNOWN avoidable spells only — table-bounded). */
  avoidableDamage: number;
}

/** Per-player verified credit for a single run. The backend resolves `nameRealm`/`realmSlug` to an
 *  account+character and persists this (deduped by run). `mechanicFailures`/`timed` feed the clean cap. */
export interface PlayerCredit {
  guid: string;
  /** "Name-Realm" exactly as the log carries it. */
  nameRealm: string;
  /** Character name without the realm suffix. */
  name: string;
  /** Best-effort realm slug for matching a verified character; '' when the log carried no realm.
   *  NOTE: derived from the realm DISPLAY name, so it can diverge from Blizzard's canonical slug for
   *  realms with unusual punctuation — the backend match tolerates this (see characterIndex.ts). */
  realmSlug: string;
  role?: PlayerRole;
  specId?: number;
  /** Mechanic-failure count (v1 = this player's deaths). The backend applies the clean cap. */
  mechanicFailures: number;
  praise: PlayerPraise;
}

export interface RunCreditResult {
  dungeon?: string;
  keyLevel?: number;
  challengeModeId?: number;
  /** Beat the dungeon timer (completed AND within the curated timer). */
  timed: boolean;
  /** Key finished at all (CHALLENGE_MODE_END success). */
  completed: boolean;
  startMs: number;
  endMs: number;
  players: PlayerCredit[];
}

/** The analytics we extract per-player credit from. Run as a subset so the verify path is cheap. */
const CREDIT_ANALYTIC_IDS = [
  'dps.overall',
  'hps.overall',
  'utility.clutch',
  'interrupts.accountability',
  'avoidableDamage',
  'deaths.recap',
] as const;

/** Split "Name-Realm" → { name, realmSlug }. Character names never contain '-', so the FIRST '-' is the
 *  separator; the realm display name maps to a slug. The slug algorithm MUST stay in lockstep with the
 *  backend's `realmSlug()` (characters.ts) so a verified character resolves on lookup. */
export function splitNameRealm(nameRealm: string): { name: string; realmSlug: string } {
  const dash = nameRealm.indexOf('-');
  if (dash < 0) return { name: nameRealm, realmSlug: '' };
  const name = nameRealm.slice(0, dash);
  const realm = nameRealm.slice(dash + 1);
  const realmSlug = realm
    .trim()
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return { name, realmSlug };
}

/**
 * Re-parse-free per-player credit for a parsed log. Picks the run to score (a carved log is one run; if
 * the log somehow holds several, the first real M+ run), runs the credit analytics over that run's
 * window, and joins the results to the run's roster. Returns null for a synthetic / no-real-run log.
 */
export function computeVerifiedCredit(
  store: ColumnStore,
  segments: Segment[],
  spellTable: SpellTable,
): RunCreditResult | null {
  const runs = segmentRuns(store);
  const run = runs.find((r) => !r.synthetic && r.contentType === 'mplus') ?? runs.find((r) => !r.synthetic);
  if (!run) return null;

  const range = { start: run.startIdx, end: run.endIdx };
  const registry = new AnalyticsRegistry().registerAll(seedAnalytics);
  const which = CREDIT_ANALYTIC_IDS.map((id) => registry.get(id)).filter((a): a is NonNullable<typeof a> => !!a);
  const ctx: AnalyticContext = { store, segments, range, spellTable };
  const byId = new Map(registry.run(ctx, which).map((r) => [r.id, r.value]));

  const dps = byId.get('dps.overall') as DamageResult | undefined;
  const hps = byId.get('hps.overall') as HealingResult | undefined;
  const clutch = byId.get('utility.clutch') as ClutchResult | undefined;
  const ia = byId.get('interrupts.accountability') as InterruptAccountabilityResult | undefined;
  const avoid = byId.get('avoidableDamage') as AvoidableDamageResult | undefined;
  const recap = byId.get('deaths.recap') as DeathRecapResult | undefined;

  const roster = buildRoster(store, range);
  const rosterNames = new Set(roster.map((p) => p.name));

  // 1-based rank by descending value, among roster players that actually contributed.
  const rankBy = (rows?: { name: string; value: number }[]): Map<string, number> => {
    const m = new Map<string, number>();
    if (!rows) return m;
    rows
      .filter((r) => rosterNames.has(r.name) && r.value > 0)
      .sort((a, b) => b.value - a.value)
      .forEach((r, i) => m.set(r.name, i + 1));
    return m;
  };
  const dpsRank = rankBy(dps?.bySource);
  const hpsRank = rankBy(hps?.bySource);

  const clutchByName = new Map(clutch?.byCaster.map((c) => [c.name, c]) ?? []);
  const iaByName = new Map(ia?.players.map((p) => [p.name, p]) ?? []);
  const avoidByName = new Map(avoid?.byUnit.map((u) => [u.name, u.value]) ?? []);
  const deathsByName = new Map<string, number>();
  for (const d of recap?.deaths ?? []) deathsByName.set(d.name, (deathsByName.get(d.name) ?? 0) + 1);

  const completed = run.completed === true;
  const timed =
    completed &&
    run.completionTimeMs != null &&
    run.timerMs != null &&
    run.completionTimeMs <= run.timerMs;

  const players: PlayerCredit[] = roster.map((p) => {
    const { name, realmSlug } = splitNameRealm(p.name);
    const c = clutchByName.get(p.name);
    const a = iaByName.get(p.name);
    const deaths = deathsByName.get(p.name) ?? 0;
    return {
      guid: p.guid,
      nameRealm: p.name,
      name,
      realmSlug,
      ...(p.role ? { role: p.role } : {}),
      ...(p.specId !== undefined ? { specId: p.specId } : {}),
      mechanicFailures: deaths,
      praise: {
        dpsRank: dpsRank.get(p.name) ?? null,
        hpsRank: hpsRank.get(p.name) ?? null,
        clutchPlays: c?.plays ?? 0,
        livesSaved: c?.lifeSaved ?? 0,
        perfectInterrupts: !!a && a.interrupted > 0 && a.missed === 0,
        interruptsLanded: a?.interrupted ?? 0,
        deaths,
        avoidableDamage: avoidByName.get(p.name) ?? 0,
      },
    };
  });

  return {
    ...(run.dungeonName ? { dungeon: run.dungeonName } : {}),
    ...(run.keystoneLevel != null ? { keyLevel: run.keystoneLevel } : {}),
    ...(run.challengeModeId != null ? { challengeModeId: run.challengeModeId } : {}),
    timed,
    completed,
    startMs: run.startMs,
    endMs: run.endMs,
    players,
  };
}
