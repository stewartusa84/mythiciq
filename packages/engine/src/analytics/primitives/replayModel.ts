// ReplayModel (#11, phase 1) — the seek primitive behind the eventual log-replay viewer. Turns the
// event stream into per-unit TIMELINE tables answerable at any time T in O(log n), so the viewer can
// scrub/play without re-scanning from the start. Phase 1 covers auras (buffs/debuffs + stacks) and
// cast bars on top of the existing HP timeline; absorb-shield depletion, the enemy dangerous-cast
// lane and GCD sim come in later phases. Everything is plain intervals because the log tells us
// exactly when each aura/cast ENDS (SPELL_AURA_REMOVED / SPELL_CAST_*), so no duration guessing.

import type { ColumnStore } from '../../columns/columnStore.js';
import type { SpellTable } from '../../spells/spellTable.js';
import { isImportantBuff } from '../../spells/auraImportance.js';
import { roleOf, type PlayerRole } from '../../spells/specIds.js';
import { cooldownsForSpec, talentCooldownsForSpec, type CooldownKind } from '../../spells/importantCooldowns.js';
import { gcdMsFromHaste } from '../../spells/haste.js';
import { capacityModeForSpec, HEALING_CAPACITY_EXTRA } from '../../spells/healingCapacity.js';
import { DAMAGE_EVENT_NAMES, HEAL_EVENT_NAMES, I32_NULL } from '../../columns/schema.js';
import { HpTimeline, buildHpTimeline, type HpSample, type IdxRange } from './hpTimeline.js';

/** Run-timeline bucketing: aim for ≤ this many buckets, but never finer than the min interval. A
 *  23-min run → ~1380 1s buckets; a short pull stays at 1s. */
const TIMELINE_MAX_BUCKETS = 1400;
const TIMELINE_MIN_BUCKET_MS = 1000;

export type AuraKind = 'BUFF' | 'DEBUFF' | 'other';
/** 'cancelled' = a cast that ended without a clean SUCCESS/INTERRUPT — the caster died/despawned
 *  mid-cast, or it was still open when the window ended. Distinct from 'interrupted' (a kick). */
export type CastResult = 'success' | 'failed' | 'interrupted' | 'in-progress' | 'cancelled';

/** A SPELL_CAST_START with no resolving SUCCESS/FAILED/INTERRUPT is "open". If the caster never
 *  dies and the cast never resolves (channels, missed close lines), cap how long its bar can show
 *  so it doesn't linger to the end of the run. No real enemy cast bar approaches this. */
const MAX_OPEN_CAST_MS = 15_000;

/** Max time after a cast within which its damage/healing can still attribute to it (combat-journal
 *  value). Each landed hit goes to the MOST RECENT preceding cast of the SAME spell, so a recast of the
 *  same spell already bounds attribution; this cap only matters for the LAST cast of a spell (a stray
 *  late proc shouldn't attach to an ancient cast). Generous enough to cover ground/channeled AoE that
 *  ticks for several seconds (Death and Decay, Consecration, Rain of Fire), which the old fixed 1.5s
 *  settle truncated — the cause of AoE casts showing little/no damage. Hits whose spell id differs from
 *  the cast id (some DoTs/procs) still get no amount (a known glance-value gap). */
const CAST_AMOUNT_MAX_LINGER_MS = 12_000;

/** Merge window for the combat journal's INCOMING-damage rows: consecutive hits from the same (source,
 *  spell) within this gap collapse into one entry, so DoT/AoE tick storms don't flood the journal. */
const INCOMING_MERGE_MS = 500;

/** Melee swings (SWING_DAMAGE_LANDED) carry NO spell id (spellId === I32_NULL). Display them under the
 *  conventional Auto Attack id so Wowhead renders a melee icon + name instead of a `spell:<null>` row. */
const MELEE_SPELL_ID = 6603;

// ---- GCD inference --------------------------------------------------------
// The log never states a player's GCD, but it leaves a fingerprint: chain-cast instant abilities and
// the spacing between them bottoms out at the global cooldown (you cannot act faster than the GCD).
// We anchor on INSTANT casts only — a hard cast's gap to the next action is gated by its cast time,
// not the GCD, so it would confound the estimate. Bloodlust/Heroism windows are excluded because
// their 30% haste shrinks the GCD and would bias the run-wide value low.
/** Bloodlust family buffs (raid-wide haste) — anchors inside these windows are dropped. */
const LUST_BUFF_IDS = new Set<number>([
  2825, // Bloodlust
  32182, // Heroism
  80353, // Time Warp
  390386, // Fury of the Aspects (Evoker)
  264667, // Primal Rage (Hunter pet)
  309658, // Feral Hide Drums
  90355, // Ancient Hysteria (legacy pet)
]);
/** Plausible GCD spacing band: floor just under the 750ms hard cap (timestamp jitter slack); ceiling
 *  just over the 1500ms base GCD (latency slack). Gaps outside this aren't GCD-bound spacing. */
export const GCD_BAND_MIN_MS = 700;
export const GCD_BAND_MAX_MS = 1650;
/** Fallback when we can't infer (too few instant casts) — the unhasted base GCD. */
export const GCD_BASE_MS = 1500;
/** Trailing window for the healer-capacity rolling read (the stoplight) — long enough to smooth a
 *  single GCD but short enough to reflect a burst. */
export const CAPACITY_WINDOW_MS = 6000;

// ---- Incoming combat-text / activity-aggregation tuning (replay overlays) ----
/** An "activity period" of incoming damage/heal: events less than this apart are one burst; once
 *  this long passes with nothing, the burst is over. */
const BURST_GAP_MS = 1000;
/** Keep showing a finished burst's total this long after its last event (so it's readable). */
const BURST_SHOW_MS = 1600;
/** Floating combat number lifetime (appears → drifts up → fades). */
const POP_FADE_MS = 1400;
/** Merge incoming events within this window into one floating number (so DoT/AoE ticks don't spam). */
const POP_MERGE_MS = 250;

/** Aggregate of a unit's CURRENT incoming-damage / -heal burst at `ms`. */
export interface CombatAggregate {
  /** landed damage summed over the active/recent damage burst */
  dmg: number;
  /** absorbed (shielded) damage over that same burst */
  absorb: number;
  /** effective healing summed over the active/recent heal burst */
  heal: number;
  /** a damage burst exists (active or lingering) */
  hasDmg: boolean;
  /** a heal burst exists (active or lingering) */
  hasHeal: boolean;
  /** still actively taking damage (last hit within BURST_GAP_MS) vs lingering total */
  dmgActive: boolean;
  /** still actively being healed */
  healActive: boolean;
}
/** A floating combat number (one merged hit) for the health-bar overlay. */
export interface CombatPop {
  kind: 'dmg' | 'heal';
  amount: number;
  /** ms since the (latest) hit in this merged group — for fade/drift. */
  age: number;
}

/** Sum a sorted tick list backward from the last event ≤ ms while gaps stay under BURST_GAP_MS. */
function burstSum<T extends { ms: number }>(
  events: readonly T[] | undefined,
  ms: number,
  amountOf: (t: T) => number,
  absorbOf?: (t: T) => number,
): { total: number; absorb: number; active: boolean } | null {
  if (!events || events.length === 0) return null;
  let lo = 0;
  let hi = events.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (events[mid]!.ms <= ms) lo = mid + 1;
    else hi = mid;
  }
  const last = lo - 1;
  if (last < 0 || ms - events[last]!.ms > BURST_SHOW_MS) return null;
  let total = 0;
  let absorb = 0;
  let j = last;
  while (j >= 0) {
    total += amountOf(events[j]!);
    if (absorbOf) absorb += absorbOf(events[j]!);
    if (j > 0 && events[j]!.ms - events[j - 1]!.ms > BURST_GAP_MS) break;
    j--;
  }
  return { total, absorb, active: ms - events[last]!.ms <= BURST_GAP_MS };
}
/** Robust low estimator: take the lowest slice of in-band gaps (the GCD-floor cluster), then a high
 *  percentile OF THAT slice — so a handful of sub-GCD outliers (off-GCD ability → next press leaking
 *  into the band) don't drag the floor down, while the long waiting tail is excluded by the slice. */
const GCD_LOW_SLICE_FRACTION = 0.25;
const GCD_LOW_SLICE_PCTL = 95;
const GCD_MIN_SAMPLES = 8;
/** Passive-proc filter: a player spell logged as `SPELL_CAST_SUCCESS` whose INSTANT casts recur
 *  faster than any possible GCD (below this floor) for a MAJORITY of its recurrences is a passive
 *  effect (e.g. Holy Paladin's Reclamation ~300ms; Devourer's Soul Fragment), not a real cast →
 *  dropped from the cast model. 600ms is under the 750ms hasted-GCD minimum. The FRACTION gate is
 *  what keeps charge abilities safe: Shield of the Righteous fires sub-floor ~2% of the time (rare
 *  double-press), a passive ~50–80%, so the two never overlap. Also de-noises GCD inference. */
const PASSIVE_GCD_FLOOR_MS = 600;
const PASSIVE_MIN_INSTANTS = 6; // need enough samples to judge
const PASSIVE_MIN_SUBFLOOR = 3; // ...and several actual sub-floor recurrences
const PASSIVE_SUBFLOOR_FRACTION = 0.5; // ...a majority of which are sub-floor (vs a charge double-tap)

/**
 * Infer a player's GCD (ms) from their casts. `casts` must be ascending by startMs (as built).
 * Anchors on instant-cast completions; gap = time to the next cast that starts strictly later; keeps
 * only gaps in the plausible GCD band and outside the supplied lust windows; returns a robust low
 * estimate of that band (see GCD_LOW_SLICE_*). undefined when there's too little signal.
 */
export function inferGcdMs(
  casts: readonly CastInterval[] | undefined,
  lustWindows: readonly { startMs: number; endMs: number }[] = [],
): number | undefined {
  if (!casts || casts.length < 2) return undefined;
  const inLust = (ms: number): boolean => lustWindows.some((w) => ms >= w.startMs && ms < w.endMs);
  const gaps: number[] = [];
  for (let i = 0; i < casts.length; i++) {
    if (!casts[i]!.instant) continue; // anchor on instant completions only (== startMs)
    const a = casts[i]!.startMs;
    if (inLust(a)) continue;
    let next = -1;
    for (let j = i + 1; j < casts.length; j++) {
      if (casts[j]!.startMs > a) {
        next = casts[j]!.startMs;
        break;
      }
    }
    if (next < 0) continue;
    const gap = next - a;
    if (gap >= GCD_BAND_MIN_MS && gap <= GCD_BAND_MAX_MS) gaps.push(gap);
  }
  if (gaps.length < GCD_MIN_SAMPLES) return undefined;
  gaps.sort((x, y) => x - y);
  const sliceLen = Math.max(1, Math.ceil(gaps.length * GCD_LOW_SLICE_FRACTION));
  const low = gaps.slice(0, sliceLen);
  const rank = Math.min(Math.max(Math.ceil((GCD_LOW_SLICE_PCTL / 100) * low.length), 1), low.length);
  return low[rank - 1];
}

/** Add the occupancy of `[startMs, endMs)` into a bucketed series (fractional per bucket), for the
 *  healer-capacity timeline. A cast spanning bucket boundaries contributes its overlap to each. */
function addOccupancy(series: number[], startMs: number, endMs: number, firstMs: number, bucketMs: number, nBuckets: number): void {
  let s = Math.max(startMs, firstMs);
  if (endMs <= s) return;
  let b = Math.floor((s - firstMs) / bucketMs);
  while (b < nBuckets && s < endMs) {
    if (b >= 0) {
      const bucketEnd = firstMs + (b + 1) * bucketMs;
      const segEnd = Math.min(endMs, bucketEnd);
      series[b]! += (segEnd - s) / bucketMs;
      s = segEnd;
    } else {
      s = firstMs + (b + 1) * bucketMs;
    }
    b++;
  }
}

/** Windows (ms) where a Bloodlust-family buff is active on `unit`, from its aura intervals. */
export function lustWindowsFor(auras: readonly AuraInterval[] | undefined): { startMs: number; endMs: number }[] {
  if (!auras) return [];
  const out: { startMs: number; endMs: number }[] = [];
  for (const a of auras) if (LUST_BUFF_IDS.has(a.spellId)) out.push({ startMs: a.startMs, endMs: a.endMs });
  return out;
}

/** One constant-stack segment of an aura's life on a unit. Split on stack (DOSE) changes so
 *  `stacks` is exact at any T; `appliedMs` is the original application (for remaining-duration). */
export interface AuraInterval {
  spellId: number;
  auraType: AuraKind;
  sourceUnit: number;
  appliedMs: number;
  startMs: number;
  /** Infinity if still active at log end. */
  endMs: number;
  stacks: number;
}

export interface CastInterval {
  spellId: number;
  targetUnit: number;
  startMs: number;
  endMs: number;
  result: CastResult;
  /** true when there was no SPELL_CAST_START (an instant cast) — zero-width bar / GCD flash. */
  instant: boolean;
  interruptedBy?: number;
  /** Tagged in serialization: an interruptible enemy cast (the dangerous-cast lane). */
  interruptible?: boolean;
  /** ...and curated 'dangerous' priority specifically. */
  dangerous?: boolean;
  /** Effective amount this cast produced — enemy damage done OR ally healing done (raw − overheal),
   *  matched by caster + spell id within a short settle window. Omitted when the cast has no measurable
   *  value (utility/buff) or its damage logs under a different spell id (a known attribution gap). */
  amount?: number;
}

export interface ActiveAura {
  spellId: number;
  auraType: AuraKind;
  sourceUnit: number;
  appliedMs: number;
  stacks: number;
}

export interface UnitReplayState {
  unitId: number;
  name: string;
  isPlayer: boolean;
  hp?: { currentHp: number; maxHp: number; fraction: number };
  auras: ActiveAura[];
  cast: CastInterval | null;
}

interface OpenAura {
  appliedMs: number;
  segStart: number;
  stacks: number;
  sourceUnit: number;
  auraType: AuraKind;
}
interface OpenCast {
  spellId: number;
  targetUnit: number;
  startMs: number;
}

const auraKind = (v: unknown): AuraKind => (v === 'BUFF' ? 'BUFF' : v === 'DEBUFF' ? 'DEBUFF' : 'other');

// Shared query helpers over startMs-sorted interval lists (used by both the engine-side ReplayModel
// and the client-side ReplayView so the seek semantics are identical on both ends of the wire).
export function activeAurasIn(list: readonly AuraInterval[] | undefined, ms: number): ActiveAura[] {
  if (!list) return [];
  const out: ActiveAura[] = [];
  for (const a of list) {
    if (a.startMs > ms) break; // sorted by startMs → nothing later can cover ms
    if (a.endMs > ms) out.push({ spellId: a.spellId, auraType: a.auraType, sourceUnit: a.sourceUnit, appliedMs: a.appliedMs, stacks: a.stacks });
  }
  return out;
}
export function castInProgressIn(list: readonly CastInterval[] | undefined, ms: number): CastInterval | null {
  if (!list) return null;
  for (const c of list) {
    if (c.startMs > ms) break;
    if (ms < c.endMs && c.endMs > c.startMs) return c; // skip zero-width instants
  }
  return null;
}
/** Hold-last HP at ms over a startMs-ascending sample list (mirrors HpTimeline.hpAt). */
export function hpSampleAt(samples: readonly HpSample[] | undefined, ms: number): HpSample | undefined {
  if (!samples || samples.length === 0 || ms < samples[0]!.ms) return undefined;
  let lo = 0;
  let hi = samples.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (samples[mid]!.ms <= ms) lo = mid + 1;
    else hi = mid;
  }
  return samples[lo - 1];
}

export class ReplayModel {
  readonly hp: HpTimeline;
  /** unitId -> aura segments, ascending by startMs. */
  readonly aurasByUnit: Map<number, AuraInterval[]>;
  /** unitId (caster) -> cast bars, ascending by startMs. */
  readonly castsByUnit: Map<number, CastInterval[]>;

  constructor(hp: HpTimeline, aurasByUnit: Map<number, AuraInterval[]>, castsByUnit: Map<number, CastInterval[]>) {
    this.hp = hp;
    this.aurasByUnit = aurasByUnit;
    this.castsByUnit = castsByUnit;
  }

  /** Build the model over the whole store, or scoped to a single run's event range. */
  static build(store: ColumnStore, range?: IdxRange): ReplayModel {
    return buildReplayModel(store, range);
  }

  /** Active auras on `unit` at time `ms` (one per concurrent aura segment covering ms). */
  aurasAt(unitId: number, ms: number): ActiveAura[] {
    return activeAurasIn(this.aurasByUnit.get(unitId), ms);
  }

  /** The cast bar in progress on `unit` at `ms` (start ≤ ms < end), or null. */
  castAt(unitId: number, ms: number): CastInterval | null {
    return castInProgressIn(this.castsByUnit.get(unitId), ms);
  }

  /** Full per-unit state at `ms` for the given units (the viewer's frame). */
  stateAt(unitIds: Iterable<number>, ms: number, store: ColumnStore): UnitReplayState[] {
    const out: UnitReplayState[] = [];
    for (const unitId of unitIds) {
      const hp = this.hp.hpAt(unitId, ms);
      out.push({
        unitId,
        name: store.actorName(unitId) || store.str(unitId),
        isPlayer: store.isPlayer(unitId),
        ...(hp ? { hp: { currentHp: hp.currentHp, maxHp: hp.maxHp, fraction: hp.fraction } } : {}),
        auras: this.aurasAt(unitId, ms),
        cast: this.castAt(unitId, ms),
      });
    }
    return out;
  }
}

function buildReplayModel(store: ColumnStore, range?: IdxRange): ReplayModel {
  const id = (n: string) => store.eventTypeId(n);
  const applied = id('SPELL_AURA_APPLIED');
  const removed = id('SPELL_AURA_REMOVED');
  const refresh = id('SPELL_AURA_REFRESH');
  const doseUp = id('SPELL_AURA_APPLIED_DOSE');
  const doseDown = id('SPELL_AURA_REMOVED_DOSE');
  const broken = id('SPELL_AURA_BROKEN');
  const brokenSpell = id('SPELL_AURA_BROKEN_SPELL');
  const castStart = id('SPELL_CAST_START');
  const castSuccess = id('SPELL_CAST_SUCCESS');
  const castFailed = id('SPELL_CAST_FAILED');
  const interrupt = id('SPELL_INTERRUPT');
  const unitDied = id('UNIT_DIED');

  const aurasByUnit = new Map<number, AuraInterval[]>();
  const castsByUnit = new Map<number, CastInterval[]>();
  const openAuras = new Map<string, OpenAura>(); // `${unit}:${spellId}`
  const openCasts = new Map<string, OpenCast>(); // `${caster}:${spellId}`
  let lastMs = 0;

  const pushAura = (unit: number, spellId: number, o: OpenAura, segEnd: number): void => {
    const list = aurasByUnit.get(unit) ?? aurasByUnit.set(unit, []).get(unit)!;
    list.push({ spellId, auraType: o.auraType, sourceUnit: o.sourceUnit, appliedMs: o.appliedMs, startMs: o.segStart, endMs: segEnd, stacks: o.stacks });
  };
  const pushCast = (caster: number, c: CastInterval): void => {
    (castsByUnit.get(caster) ?? castsByUnit.set(caster, []).get(caster)!).push(c);
  };

  const lo = range?.start ?? 0;
  const hi = range?.end ?? store.count;
  for (let i = lo; i < hi; i++) {
    const et = store.eventType[i]!;
    const ms = store.ts[i]!;
    lastMs = ms;

    // ---- auras ----
    if (et === applied || et === removed || et === refresh || et === doseUp || et === doseDown || et === broken || et === brokenSpell) {
      const unit = store.targetGuid[i]!;
      const spellId = store.spellIdNum(i);
      if (unit === 0 || spellId === null) continue;
      const key = `${unit}:${spellId}`;
      const open = openAuras.get(key);
      if (et === applied) {
        if (open) pushAura(unit, spellId, open, ms); // unexpected re-apply → close prior run
        openAuras.set(key, { appliedMs: ms, segStart: ms, stacks: 1, sourceUnit: store.sourceGuid[i]!, auraType: auraKind(store.detail(i, 'auraType')) });
      } else if (et === removed || et === broken || et === brokenSpell) {
        if (open) {
          pushAura(unit, spellId, open, ms);
          openAuras.delete(key);
        }
      } else if (et === doseUp || et === doseDown) {
        if (open) {
          pushAura(unit, spellId, open, ms); // close the constant-stack segment
          open.stacks += et === doseUp ? 1 : -1;
          open.segStart = ms;
        }
      } // refresh: keep the run open (it ends on REMOVED); no segment change
      continue;
    }

    // ---- casts ----
    if (et === castStart) {
      const caster = store.sourceGuid[i]!;
      const spellId = store.spellIdNum(i);
      if (caster === 0 || spellId === null) continue;
      const tgt0 = store.targetGuid[i]!;
      openCasts.set(`${caster}:${spellId}`, { spellId, targetUnit: tgt0 === caster ? 0 : tgt0, startMs: ms });
    } else if (et === castSuccess) {
      const caster = store.sourceGuid[i]!;
      const spellId = store.spellIdNum(i);
      if (caster === 0 || spellId === null) continue;
      const key = `${caster}:${spellId}`;
      const open = openCasts.get(key);
      if (open) {
        pushCast(caster, { spellId, targetUnit: open.targetUnit, startMs: open.startMs, endMs: ms, result: 'success', instant: false });
        openCasts.delete(key);
      } else {
        const tgt1 = store.targetGuid[i]!;
        pushCast(caster, { spellId, targetUnit: tgt1 === caster ? 0 : tgt1, startMs: ms, endMs: ms, result: 'success', instant: true });
      }
    } else if (et === castFailed) {
      const caster = store.sourceGuid[i]!;
      const spellId = store.spellIdNum(i);
      if (caster === 0 || spellId === null) continue;
      const key = `${caster}:${spellId}`;
      const open = openCasts.get(key);
      if (open) {
        pushCast(caster, { spellId, targetUnit: open.targetUnit, startMs: open.startMs, endMs: ms, result: 'failed', instant: false });
        openCasts.delete(key);
      }
    } else if (et === interrupt) {
      // SPELL_INTERRUPT: source interrupts target's cast of extraSpellId.
      const caster = store.targetGuid[i]!;
      const spellId = store.detailNumber(i, 'extraSpellId');
      if (caster === 0 || spellId === undefined) continue;
      const key = `${caster}:${spellId}`;
      const open = openCasts.get(key);
      if (open) {
        pushCast(caster, { spellId, targetUnit: open.targetUnit, startMs: open.startMs, endMs: ms, result: 'interrupted', instant: false, interruptedBy: store.sourceGuid[i]! });
        openCasts.delete(key);
      }
    } else if (et === unitDied) {
      // A unit that dies/despawns mid-cast ends the cast right then (no SUCCESS/INTERRUPT will come).
      // Close its open casts at the death so the bar stops there instead of lingering to run end.
      const dead = store.targetGuid[i]!;
      if (dead === 0) continue;
      const prefix = `${dead}:`;
      for (const [key, o] of openCasts) {
        if (!key.startsWith(prefix)) continue;
        pushCast(dead, { spellId: o.spellId, targetUnit: o.targetUnit, startMs: o.startMs, endMs: ms, result: 'cancelled', instant: false });
        openCasts.delete(key);
      }
    }
  }

  // Close auras/casts still open at window end. Auras stay active to the end (Infinity); casts are
  // capped (MAX_OPEN_CAST_MS) so an unresolved cast that never closed doesn't paint a run-long bar.
  for (const [key, o] of openAuras) {
    const sep = key.indexOf(':');
    const unit = Number(key.slice(0, sep));
    pushAura(unit, Number(key.slice(sep + 1)), o, Infinity);
  }
  for (const [key, o] of openCasts) {
    const caster = Number(key.slice(0, key.indexOf(':')));
    const endMs = Math.min(lastMs, o.startMs + MAX_OPEN_CAST_MS);
    pushCast(caster, { spellId: o.spellId, targetUnit: o.targetUnit, startMs: o.startMs, endMs, result: 'in-progress', instant: false });
  }

  // Segments are PUSHED at close time (on REMOVED / SUCCESS / …), so each list is ordered by end,
  // not start. The aurasAt/castAt queries binary-walk by startMs, so sort each list by startMs.
  for (const list of aurasByUnit.values()) list.sort((a, b) => a.startMs - b.startMs);
  for (const list of castsByUnit.values()) list.sort((a, b) => a.startMs - b.startMs);

  // Strip PASSIVE procs that log as casts (Reclamation et al.): per caster, a spell whose INSTANT
  // casts repeatedly recur below the GCD floor isn't GCD-gated → not a real cast. Drop all its casts.
  // (Done after the startMs sort so consecutive gaps are real.) Also de-noises GCD inference.
  for (const [unit, list] of castsByUnit) {
    const lastInstant = new Map<number, number>(); // spellId -> previous instant startMs
    const instants = new Map<number, number>(); // spellId -> instant cast count
    const subFloor = new Map<number, number>(); // spellId -> sub-GCD-floor recurrence count
    for (const c of list) {
      if (!c.instant) continue;
      instants.set(c.spellId, (instants.get(c.spellId) ?? 0) + 1);
      const prev = lastInstant.get(c.spellId);
      if (prev !== undefined && c.startMs - prev < PASSIVE_GCD_FLOOR_MS) {
        subFloor.set(c.spellId, (subFloor.get(c.spellId) ?? 0) + 1);
      }
      lastInstant.set(c.spellId, c.startMs);
    }
    let passive: Set<number> | undefined;
    for (const [sid, n] of subFloor) {
      const gaps = (instants.get(sid) ?? 0) - 1;
      if ((instants.get(sid) ?? 0) >= PASSIVE_MIN_INSTANTS && n >= PASSIVE_MIN_SUBFLOOR && gaps > 0 && n / gaps >= PASSIVE_SUBFLOOR_FRACTION) {
        (passive ??= new Set()).add(sid);
      }
    }
    if (passive) castsByUnit.set(unit, list.filter((c) => !passive!.has(c.spellId)));
  }
  return new ReplayModel(buildHpTimeline(store, range), aurasByUnit, castsByUnit);
}

// ---------------------------------------------------------------------------
// Serialization (worker → main thread) + the client-side query view.
// The model is sent ONCE per parse (a few MB), so we ship plain structured-cloneable data (Maps are
// clone-safe) with unit/spell metadata BAKED IN — the client view needs no columnar store.
// ---------------------------------------------------------------------------

export interface ReplayUnit {
  unitId: number;
  name: string;
  isPlayer: boolean;
  /** player group role (from COMBATANT_INFO specId), for ordering; undefined if unknown. */
  role?: PlayerRole;
  /** COMBATANT_INFO specId — drives the spec icon + class color on the player card. */
  specId?: number;
  /** COMBATANT_INFO haste rating (drives the haste-derived GCD + capacity). Players only. */
  hasteRating?: number;
  /** GCD (ms): haste-derived when haste is known, else inferred from cast cadence (see inferGcdMs);
   *  absent if neither is available → the viewer falls back to GCD_BASE_MS. Players only. */
  gcdMs?: number;
}
export interface ReplayDeath {
  ms: number;
  unitId: number;
  name: string;
  isPlayer: boolean;
}
/** A scrub-to-able moment on the timeline: boss pull / boss end (kill or wipe) / player death. */
export type BookmarkKind = 'boss-start' | 'boss-end' | 'death';
export interface ReplayBookmark {
  ms: number;
  kind: BookmarkKind;
  label: string;
  /** boss-end only: true = kill, false = wipe. */
  success?: boolean;
}
export interface PowerSample {
  ms: number;
  current: number;
  max: number;
}

/** Bucketed activity sums over the whole run, for the WCL-style timeline graph. Each array is
 *  bucket-aligned (`value[b]` covers `[startMs + b*bucketMs, +bucketMs)`). Player↔enemy only. */
export interface RunTimeline {
  bucketMs: number;
  startMs: number;
  /** player → enemy damage */
  dmgDone: number[];
  /** enemy → player damage */
  dmgTaken: number[];
  /** player effective healing output (amount − overheal) */
  healDone: number[];
  /** player effective healing received */
  healTaken: number[];
}
/** One ranked entry in a live DPS/HPS meter: a player and their rate (per second) up to the clock. */
export interface MeterRow {
  unitId: number;
  name: string;
  value: number;
}
/** A single avoidable-mechanic hit on a player (a "missed mechanic"), for the timeline overlay. */
export interface AvoidableHit {
  ms: number;
  unitId: number;
  spellId: number;
  amount: number;
}
/** One incoming damage event on a player (for floating combat text + activity aggregation).
 *  `amount` is the landed damage (HP lost); `absorbed` is the portion eaten by a shield on the
 *  SAME hit (partial absorbs — fully-absorbed hits log as SPELL_ABSORBED and aren't captured). */
export interface DamageTick {
  ms: number;
  amount: number;
  absorbed: number;
}
/** One incoming heal event on a player; `amount` is EFFECTIVE healing (raw − overheal). */
export interface HealTick {
  ms: number;
  amount: number;
}
/** One incoming-damage entry for a player's combat journal, MERGED per (source, spell) within a short
 *  window so DoT/AoE tick storms collapse into one row. `amount` = landed damage, `absorbed` = portion
 *  eaten by a shield, `src` = enemy source unit id (name resolved via targetNames / nameOf). */
export interface IncomingHit {
  ms: number;
  spellId: number;
  amount: number;
  absorbed: number;
  src: number;
}
/** A player's important cooldown + the times they cast it (for availability over the replay). */
export interface CooldownState {
  spellId: number;
  name: string;
  cooldownSeconds: number;
  kind: CooldownKind;
  /** cast start times (ms), ascending; empty = never used (assumed available from run start). */
  casts: number[];
  /** For `kind:'dispel'` — removal categories this dispel clears (drives the "dispel needed now" glow). */
  provides?: string[];
}
/** Availability of one cooldown at a queried time T. */
export interface CooldownStatus {
  spellId: number;
  name: string;
  kind: CooldownKind;
  /** off cooldown right now */
  ready: boolean;
  /** ms until ready (0 when ready) */
  readyInMs: number;
  /** ms since the player last cast it (undefined = never cast before T) — for a "just used" flash. */
  sinceCastMs?: number;
  /** For `kind:'dispel'` — removal categories this dispel clears (matched vs. active debuffs to glow). */
  provides?: string[];
}
/** A boss encounter window (ENCOUNTER_START..END), for the timeline's highlighted region. */
export interface EncounterSpan {
  startMs: number;
  endMs: number;
  name: string;
  success?: boolean;
}
/** A successful interrupt, for the timeline overlay. */
export interface InterruptEvent {
  ms: number;
  /** the interrupter (player) */
  byUnit: number;
  /** the unit whose cast was interrupted */
  casterUnit: number;
  /** the interrupted spell id */
  spellId: number;
}

export interface ReplayModelData {
  firstMs: number;
  lastMs: number;
  units: ReplayUnit[];
  aurasByUnit: Map<number, AuraInterval[]>;
  castsByUnit: Map<number, CastInterval[]>;
  hpByUnit: Map<number, HpSample[]>;
  /** unitId → powerType → hold-last samples, ascending by ms. Players only. */
  powerByUnit: Map<number, Map<number, PowerSample[]>>;
  deaths: ReplayDeath[];
  spellNames: Map<number, string>;
  /** Buff spell ids to surface in the replay's "important" lane (rest of the buffs → misc). */
  importantBuffIds: number[];
  /** Timeline markers (boss start/end, player deaths), ascending by ms. */
  bookmarks: ReplayBookmark[];
  /** Names for cast-target units not already in `units` (e.g. enemies that are only targets). */
  targetNames: Map<number, string>;
  /** Bucketed damage/healing sums over the run, for the timeline graph. */
  timeline: RunTimeline;
  /** Avoidable-mechanic hits on players ("missed mechanics"), ascending by ms. */
  avoidableHits: AvoidableHit[];
  /** Boss encounter windows (highlighted regions on the timeline), ascending by start. */
  encounters: EncounterSpan[];
  /** Per-player incoming damage events (ascending by ms) — floating combat text + aggregation. */
  dmgByUnit: Map<number, DamageTick[]>;
  /** Per-player incoming (effective) heal events (ascending by ms). */
  healByUnit: Map<number, HealTick[]>;
  /** Per-player incoming damage merged per (source, spell) — drives the combat journal's incoming
   *  rows (ascending by ms). */
  incomingByUnit: Map<number, IncomingHit[]>;
  /** Per-player important cooldowns (interrupt + raid/external majors) with their cast times. */
  cooldownsByUnit: Map<number, CooldownState[]>;
  /** Dangerous-dispellable DEBUFF spellId → its removable categories (drives the dispel-needed glow). */
  dispellableBySpell: Map<number, string[]>;
  /** ALL dangerous DEBUFF spellIds (dispellable OR heal-through) — drives the player-card danger
   *  highlight. A subset (the dispellable ones) also appears in `dispellableBySpell`. */
  dangerousDebuffs: Set<number>;
  /** Per-player bucketed damage done to enemies (timeline-aligned) — drives the live DPS meter. */
  dmgDoneByUnit: Map<number, number[]>;
  /** Per-player bucketed effective healing output (timeline-aligned) — drives the live HPS meter. */
  healDoneByUnit: Map<number, number[]>;
  /** Per-HEALER bucketed capacity (0..1, timeline-aligned): fraction of time spent on healing casts. */
  capacityByUnit: Map<number, number[]>;
}

/** Flatten a built ReplayModel into transferable data: bake unit names / isPlayer / spell names, tag
 *  interruptible enemy casts (the dangerous-cast lane), and collect the UNIT_DIED kill feed. When
 *  `range` is given (a single run), the kill feed and firstMs/lastMs are scoped to that run. */
export function toReplayData(model: ReplayModel, store: ColumnStore, table?: SpellTable, range?: IdxRange): ReplayModelData {
  const unitIds = new Set<number>([...model.aurasByUnit.keys(), ...model.castsByUnit.keys(), ...model.hp.byUnit.keys()]);
  // Player spec from COMBATANT_INFO (guid string -> specId), so the viewer can order tank → healer →
  // dps and show a spec icon + class color. COMBATANT_INFO is rare; scan the whole store.
  const specByGuid = new Map<string, number>();
  const hasteByGuid = new Map<string, number>();
  const ciId = store.eventTypeId('COMBATANT_INFO');
  if (ciId !== undefined) {
    for (let i = 0; i < store.count; i++) {
      if (store.eventType[i] !== ciId) continue;
      const guid = store.detail(i, 'playerGuid');
      if (typeof guid !== 'string') continue;
      const spec = store.detailNumber(i, 'specId');
      if (spec !== undefined) specByGuid.set(guid, spec);
      const haste = store.detailNumber(i, 'hasteRating');
      if (haste !== undefined) hasteByGuid.set(guid, haste);
    }
  }
  const units: ReplayUnit[] = [...unitIds].map((unitId) => {
    const isPlayer = store.isPlayer(unitId);
    const specId = isPlayer ? specByGuid.get(store.str(unitId)) : undefined;
    const role = roleOf(specId);
    const hasteRating = isPlayer ? hasteByGuid.get(store.str(unitId)) : undefined;
    // GCD: prefer the haste-derived value (COMBATANT_INFO haste rating); fall back to inferring it from
    // the player's cast cadence (instant-cast spacing, lust windows excluded) when haste is unknown.
    const gcdMs = !isPlayer
      ? undefined
      : hasteRating !== undefined
        ? gcdMsFromHaste(hasteRating)
        : inferGcdMs(model.castsByUnit.get(unitId), lustWindowsFor(model.aurasByUnit.get(unitId)));
    return {
      unitId,
      name: store.actorName(unitId) || store.str(unitId),
      isPlayer,
      ...(role ? { role } : {}),
      ...(specId !== undefined ? { specId } : {}),
      ...(hasteRating !== undefined ? { hasteRating } : {}),
      ...(gcdMs !== undefined ? { gcdMs } : {}),
    };
  });

  const spellIds = new Set<number>();
  for (const list of model.aurasByUnit.values()) for (const a of list) spellIds.add(a.spellId);

  // Tag enemy casts with interruptible/dangerous so the viewer's enemy lane can surface them.
  const castsByUnit = new Map<number, CastInterval[]>();
  for (const [unit, list] of model.castsByUnit) {
    const enemy = !store.isPlayer(unit);
    castsByUnit.set(
      unit,
      list.map((c) => {
        spellIds.add(c.spellId);
        if (enemy && table) {
          const pr = table.interruptPriority(c.spellId);
          if (pr !== null) return { ...c, interruptible: true, dangerous: pr === 'dangerous' };
        }
        return c;
      }),
    );
  }

  // Per-player important cooldowns: the FULL kit known from the player's spec (interrupt + class
  // raid/external major), so each shows available from run start — no waiting for the first cast.
  // Availability is then tracked from the player's cast times (matched across faction variants, e.g.
  // Bloodlust ⇆ Heroism).
  const cooldownsByUnit = new Map<number, CooldownState[]>();
  for (const u of units) {
    if (!u.isPlayer) continue;
    const castTimesBySpell = new Map<number, number[]>();
    for (const c of castsByUnit.get(u.unitId) ?? []) {
      if (c.result === 'failed') continue;
      (castTimesBySpell.get(c.spellId) ?? castTimesBySpell.set(c.spellId, []).get(c.spellId)!).push(c.startMs);
    }
    const castsFor = (castIds: number[]): number[] => {
      let casts: number[] = [];
      for (const id of castIds) {
        const times = castTimesBySpell.get(id);
        if (times) casts = casts.length ? casts.concat(times) : times.slice();
      }
      casts.sort((a, b) => a - b);
      return casts;
    };
    // Baseline kit (interrupt + class/spec majors) shows from run start; talent-gated CDs appear
    // ONLY once actually cast (we can't know from spec whether the player talented them).
    const toState = (k: ReturnType<typeof cooldownsForSpec>[number], casts: number[]): CooldownState => ({
      spellId: k.spellId, name: k.name, cooldownSeconds: k.cooldownSeconds, kind: k.kind, casts,
      ...(k.provides ? { provides: k.provides } : {}),
    });
    const list = cooldownsForSpec(u.specId).map<CooldownState>((k) => toState(k, castsFor(k.castIds)));
    for (const k of talentCooldownsForSpec(u.specId)) {
      const casts = castsFor(k.castIds);
      if (casts.length) list.push(toState(k, casts));
    }
    if (list.length) cooldownsByUnit.set(u.unitId, list);
  }

  // Which DEBUFF aura ids are dangerous AND dispellable, and by what categories — so the viewer can
  // light a healer's dispel chip when a matching debuff is up (the dispel's "needs me now" signal).
  const dispellableBySpell = new Map<number, string[]>();
  const dangerousDebuffs = new Set<number>();
  if (table) {
    for (const id of spellIds) {
      if (!table.isDangerousDebuff(id)) continue;
      dangerousDebuffs.add(id);
      const cats = table.removableCategoriesOf(id);
      if (cats.length) dispellableBySpell.set(id, [...cats]);
    }
  }

  const spellNames = new Map<number, string>();
  for (const id of spellIds) spellNames.set(id, store.spellName(id) || `spell:${id}`);

  const hpByUnit = new Map<number, HpSample[]>();
  for (const [unit, t] of model.hp.byUnit) hpByUnit.set(unit, t.samples);

  // Classify buffs once: important (curated defensive or notable) vs misc (everything else). Debuffs
  // are grouped by auraType on the client, so only non-DEBUFF auras need an importance verdict.
  const importantBuffIds: number[] = [];
  const seenBuff = new Set<number>();
  for (const list of model.aurasByUnit.values()) {
    for (const a of list) {
      if (a.auraType === 'DEBUFF' || seenBuff.has(a.spellId)) continue;
      seenBuff.add(a.spellId);
      if (isImportantBuff(a.spellId, table)) importantBuffIds.push(a.spellId);
    }
  }

  const lo = range?.start ?? 0;
  const hi = range?.end ?? store.count;

  // Power timeline: hold-last per-player resource values (advanced block, players only).
  const powerByUnit = new Map<number, Map<number, PowerSample[]>>();
  const playerIds = new Set(units.filter((u) => u.isPlayer).map((u) => u.unitId));

  const firstMs = hi > lo ? store.ts[lo]! : 0;
  const lastMs = hi > lo ? store.ts[hi - 1]! : 0;

  // Run-timeline buckets (damage/healing done & taken) + the avoidable-hit / encounter overlays.
  const durMs = Math.max(0, lastMs - firstMs);
  const bucketMs = Math.max(TIMELINE_MIN_BUCKET_MS, Math.ceil(Math.max(durMs, 1) / TIMELINE_MAX_BUCKETS));
  const nBuckets = Math.max(1, Math.floor(durMs / bucketMs) + 1);
  const dmgDone = new Array<number>(nBuckets).fill(0);
  const dmgTaken = new Array<number>(nBuckets).fill(0);
  const healDone = new Array<number>(nBuckets).fill(0);
  const healTaken = new Array<number>(nBuckets).fill(0);
  const damageIds = store.eventTypeIds(DAMAGE_EVENT_NAMES);
  const healIds = store.eventTypeIds(HEAL_EVENT_NAMES);
  const swingIds = store.eventTypeIds(['SWING_DAMAGE', 'SWING_DAMAGE_LANDED']); // null spell id ⇒ melee
  // Per-player cast spell ids + spell-name → cast id, so damage/heal that logs under a DIFFERENT id than
  // the cast (e.g. Spinning Crane Kick: cast 101546, ticks 107270 — same NAME) can be attributed to the
  // matching cast by name. Without this, such abilities show no value in the combat journal.
  const castSpellIdsByUnit = new Map<number, Set<number>>();
  const castIdByNameByUnit = new Map<number, Map<string, number>>();
  for (const [unit, list] of model.castsByUnit) {
    if (!store.isPlayer(unit)) continue;
    const ids = new Set<number>();
    const byName = new Map<string, number>();
    for (const c of list) {
      ids.add(c.spellId);
      const name = store.spellName(c.spellId);
      if (name && !byName.has(name)) byName.set(name, c.spellId);
    }
    castSpellIdsByUnit.set(unit, ids);
    castIdByNameByUnit.set(unit, byName);
  }
  // Per-(caster unit, spell id) effective amounts (enemy damage done / ally healing done), used after
  // the pass to attach a value to each cast for the combat journal.
  const castAmtIndex = new Map<number, Map<number, { ms: number; amt: number }[]>>();
  const recordCastAmt = (unit: number, spell: number, ms: number, amt: number): void => {
    if (amt <= 0) return;
    let m = castAmtIndex.get(unit);
    if (!m) { m = new Map(); castAmtIndex.set(unit, m); }
    // Alias an orphan damage/heal id (not itself a cast id) to a same-named cast id (SCK 107270→101546).
    let key = spell;
    const castIds = castSpellIdsByUnit.get(unit);
    if (castIds && !castIds.has(spell)) {
      const aliased = castIdByNameByUnit.get(unit)?.get(store.spellName(spell));
      if (aliased !== undefined) key = aliased;
    }
    (m.get(key) ?? m.set(key, []).get(key)!).push({ ms, amt });
  };
  const avoidableHits: AvoidableHit[] = [];
  const encounters: EncounterSpan[] = [];
  let openEnc: { startMs: number; name: string } | null = null;
  // Per-player incoming damage / heal streams (pushed in ms order ⇒ already sorted).
  const dmgByUnit = new Map<number, DamageTick[]>();
  const healByUnit = new Map<number, HealTick[]>();
  // Raw per-player incoming hits (with spell + source) for the combat journal, merged after the pass.
  const incomingRaw = new Map<number, { ms: number; spellId: number; amount: number; absorbed: number; src: number }[]>();
  // Per-player OUTGOING damage/heal, bucketed like the timeline — drives the live DPS/HPS meters.
  const dmgDoneByUnit = new Map<number, number[]>();
  const healDoneByUnit = new Map<number, number[]>();
  // Spell ids each player produced healing with (any heal event, even full overheal) — the log-derived
  // "this is a heal spell" set used to classify healing-capacity casts.
  const healSpellsByUnit = new Map<number, Set<number>>();
  const meterBucket = (m: Map<number, number[]>, u: number): number[] => {
    let a = m.get(u);
    if (!a) { a = new Array<number>(nBuckets).fill(0); m.set(u, a); }
    return a;
  };

  const deaths: ReplayDeath[] = [];
  const died = store.eventTypeId('UNIT_DIED');
  const encStart = store.eventTypeId('ENCOUNTER_START');
  const encEnd = store.eventTypeId('ENCOUNTER_END');
  const bookmarks: ReplayBookmark[] = [];
  for (let i = lo; i < hi; i++) {
    const et = store.eventType[i]!;
    const ms = store.ts[i]!;
    if (died !== undefined && et === died) {
      const u = store.targetGuid[i]!;
      if (u === 0) continue;
      const isPlayer = store.isPlayer(u);
      const name = store.actorName(u) || store.str(u);
      deaths.push({ ms, unitId: u, name, isPlayer });
      if (isPlayer) bookmarks.push({ ms, kind: 'death', label: name });
    } else if (encStart !== undefined && et === encStart) {
      const name = strDetail(store, i, 'encounterName') ?? 'Encounter';
      bookmarks.push({ ms, kind: 'boss-start', label: name });
      openEnc = { startMs: ms, name };
    } else if (encEnd !== undefined && et === encEnd) {
      const name = strDetail(store, i, 'encounterName') ?? 'Encounter';
      const s = store.detail(i, 'success');
      const success = typeof s === 'boolean' ? s : s === 1;
      bookmarks.push({ ms, kind: 'boss-end', label: name, success });
      encounters.push({ startMs: openEnc?.startMs ?? firstMs, endMs: ms, name: openEnc?.name ?? name, success });
      openEnc = null;
    }
    // Timeline buckets: classify damage/healing (and flag avoidable hits on players).
    if (damageIds.has(et) || healIds.has(et)) {
      const b = Math.min(nBuckets - 1, Math.max(0, Math.floor((ms - firstMs) / bucketMs)));
      const src = store.ownerOf(store.sourceGuid[i]!); // pet damage/healing → its owner (player)
      const srcP = store.isPlayer(src);
      const tgt = store.targetGuid[i]!;
      const tgtP = store.isPlayer(tgt);
      if (damageIds.has(et)) {
        const amt = store.amount[i]!;
        if (srcP && !tgtP) { dmgDone[b]! += amt; meterBucket(dmgDoneByUnit, src)[b]! += amt; recordCastAmt(src, store.spellId[i]!, ms, amt); }
        if (tgtP && !srcP) {
          dmgTaken[b]! += amt;
          const spell = store.spellId[i]!;
          if (table?.isAvoidable(spell)) avoidableHits.push({ ms, unitId: tgt, spellId: spell, amount: amt });
        }
        if (tgtP) {
          const absorbed = store.detailNumber(i, 'absorbed') ?? 0;
          if (amt > 0 || absorbed > 0) {
            (dmgByUnit.get(tgt) ?? dmgByUnit.set(tgt, []).get(tgt)!).push({ ms, amount: amt, absorbed });
            const rawSpell = store.spellId[i]!;
            // SWING (melee) and ENVIRONMENTAL damage carry no spell id; show swings under the melee id,
            // leave other null-id (environmental) as the sentinel (labelled in the merge pass).
            const incSpell = rawSpell === I32_NULL && swingIds.has(et) ? MELEE_SPELL_ID : rawSpell;
            (incomingRaw.get(tgt) ?? incomingRaw.set(tgt, []).get(tgt)!).push({ ms, spellId: incSpell, amount: amt, absorbed, src: store.sourceGuid[i]! });
          }
        }
      } else {
        const overheal = store.detailNumber(i, 'overheal') ?? store.detailNumber(i, 'overhealing') ?? 0;
        const eff = Math.max(0, store.amount[i]! - overheal);
        if (srcP) {
          healDone[b]! += eff;
          meterBucket(healDoneByUnit, src)[b]! += eff;
          (healSpellsByUnit.get(src) ?? healSpellsByUnit.set(src, new Set()).get(src)!).add(store.spellId[i]!);
          recordCastAmt(src, store.spellId[i]!, ms, eff);
        }
        if (tgtP) {
          healTaken[b]! += eff;
          if (eff > 0) (healByUnit.get(tgt) ?? healByUnit.set(tgt, []).get(tgt)!).push({ ms, amount: eff });
        }
      }
    }
    // Power snapshot — hold-last resource timeline, players only.
    const snap = store.powerSnapshot(i);
    if (snap && playerIds.has(snap.unitId)) {
      let byType = powerByUnit.get(snap.unitId);
      if (!byType) { byType = new Map(); powerByUnit.set(snap.unitId, byType); }
      let samples = byType.get(snap.powerType);
      if (!samples) { samples = []; byType.set(snap.powerType, samples); }
      const last = samples.length > 0 ? samples[samples.length - 1]! : null;
      if (!last || last.current !== snap.currentPower || last.max !== snap.maxPower) {
        samples.push({ ms, current: snap.currentPower, max: snap.maxPower });
      }
    }
  }
  if (openEnc) encounters.push({ startMs: openEnc.startMs, endMs: lastMs, name: openEnc.name });
  bookmarks.sort((a, b) => a.ms - b.ms);
  const timeline: RunTimeline = { bucketMs, startMs: firstMs, dmgDone, dmgTaken, healDone, healTaken };

  // Attach each player cast's effective value (enemy damage / ally healing) for the combat journal.
  // Every landed hit is assigned to the MOST RECENT preceding cast of the SAME spell (a recast bounds
  // the previous cast; a generous linger cap stops a stray late proc attaching to an old cast). This
  // captures multi-target AoE (all hits at ~one ms) AND ground/channeled AoE that ticks for seconds —
  // the latter is what the old fixed 1.5s window truncated. Hits whose spell id differs from the cast
  // id (some DoTs/procs) still get no amount (a known glance-value gap).
  for (const m of castAmtIndex.values()) for (const list of m.values()) list.sort((a, b) => a.ms - b.ms);
  for (const [unit, list] of castsByUnit) {
    if (!store.isPlayer(unit)) continue;
    const bySpell = castAmtIndex.get(unit);
    if (!bySpell) continue;
    // Group the unit's eligible (completed) casts by spell id, ascending by start.
    const castsBySpell = new Map<number, CastInterval[]>();
    for (const c of list) {
      if (c.result === 'failed' || c.result === 'interrupted' || c.result === 'cancelled' || c.result === 'in-progress') continue;
      (castsBySpell.get(c.spellId) ?? castsBySpell.set(c.spellId, []).get(c.spellId)!).push(c);
    }
    for (const [spell, casts] of castsBySpell) {
      const hits = bySpell.get(spell);
      if (!hits) continue;
      casts.sort((a, b) => a.startMs - b.startMs);
      // hits ascending by ms; advance a single cast pointer to the last cast started ≤ hit.ms.
      let ci = 0;
      for (const h of hits) {
        while (ci + 1 < casts.length && casts[ci + 1]!.startMs <= h.ms) ci++;
        const c = casts[ci]!;
        if (h.ms < c.startMs || h.ms > c.endMs + CAST_AMOUNT_MAX_LINGER_MS) continue;
        c.amount = (c.amount ?? 0) + h.amt;
      }
    }
  }

  // Merge incoming damage per (source, spell) within INCOMING_MERGE_MS → combat-journal rows. Raw lists
  // are already ms-ordered (built in the main pass), so a single walk with per-key open entries works.
  const incomingByUnit = new Map<number, IncomingHit[]>();
  const incomingSrcIds = new Set<number>();
  for (const [unit, raw] of incomingRaw) {
    const out: IncomingHit[] = [];
    const open = new Map<string, { entry: IncomingHit; last: number }>();
    for (const h of raw) {
      incomingSrcIds.add(h.src);
      const key = `${h.src}:${h.spellId}`;
      const o = open.get(key);
      if (o && h.ms - o.last <= INCOMING_MERGE_MS) {
        o.entry.amount += h.amount;
        o.entry.absorbed += h.absorbed;
        o.last = h.ms;
      } else {
        if (!spellNames.has(h.spellId)) {
          const fallback = h.spellId === MELEE_SPELL_ID ? 'Melee' : h.spellId === I32_NULL ? 'Environment' : `spell:${h.spellId}`;
          spellNames.set(h.spellId, store.spellName(h.spellId) || fallback);
        }
        const entry: IncomingHit = { ms: h.ms, spellId: h.spellId, amount: h.amount, absorbed: h.absorbed, src: h.src };
        out.push(entry);
        open.set(key, { entry, last: h.ms });
      }
    }
    out.sort((a, b) => a.ms - b.ms);
    incomingByUnit.set(unit, out);
  }

  // Healer capacity: per bucket, the fraction of time the healer spent on healing-classified casts
  // (cast time for hard casts, a haste-derived GCD for instants; Disc/MW count every cast — see
  // healingCapacity.ts). A pressure proxy, NOT ground truth (ignores movement/LoS/mana).
  const capacityByUnit = new Map<number, number[]>();
  for (const u of units) {
    const mode = u.isPlayer ? capacityModeForSpec(u.specId) : undefined;
    if (!mode) continue;
    const casts = model.castsByUnit.get(u.unitId);
    if (!casts || !casts.length) continue;
    const healSet = healSpellsByUnit.get(u.unitId);
    const extra = u.specId !== undefined ? HEALING_CAPACITY_EXTRA[u.specId] : undefined;
    const counts = (spellId: number): boolean =>
      mode === 'all' || (healSet?.has(spellId) ?? false) || (extra?.includes(spellId) ?? false);
    const lustWins = lustWindowsFor(model.aurasByUnit.get(u.unitId));
    const inLust = (ms: number) => lustWins.some((w) => ms >= w.startMs && ms < w.endMs);
    const haste = u.hasteRating ?? 0;
    const series = new Array<number>(nBuckets).fill(0);
    for (const c of casts) {
      if (c.result === 'failed') continue; // a failed (never-landed) cast consumed no time
      if (!counts(c.spellId)) continue;
      const gcd = gcdMsFromHaste(haste, { lust: inLust(c.startMs) });
      const cost = c.instant ? gcd : Math.max(c.endMs - c.startMs, gcd);
      addOccupancy(series, c.startMs, c.startMs + cost, firstMs, bucketMs, nBuckets);
    }
    for (let b = 0; b < nBuckets; b++) if (series[b]! > 1) series[b] = 1; // overlap / off-GCD weaving
    capacityByUnit.set(u.unitId, series);
  }

  // Names for cast targets not covered by `units` (units that only appear as targets —
  // enemies with no casts, no HP data, no auras — so the cast bar can show "→ Mob Name"
  // instead of "→ #N".
  const knownUnitIds = new Set(units.map((u) => u.unitId));
  const targetNames = new Map<number, string>();
  for (const list of castsByUnit.values()) {
    for (const c of list) {
      if (c.targetUnit !== 0 && !knownUnitIds.has(c.targetUnit) && !targetNames.has(c.targetUnit)) {
        // Only store a REAL actor name — never a raw GUID fallback (nil `0000…` or an unnamed
        // `Creature-…`), so "spell → target" never shows a GUID for a no-target / unnamed cast.
        const name = store.actorName(c.targetUnit);
        if (name) targetNames.set(c.targetUnit, name);
      }
    }
  }
  // Names for incoming-damage sources (enemies that only ever hit a player — never cast a bar), so the
  // journal can show "← Mob Name". Real names only (no GUID fallback), like cast targets above.
  for (const id of incomingSrcIds) {
    if (id !== 0 && !knownUnitIds.has(id) && !targetNames.has(id)) {
      const name = store.actorName(id);
      if (name) targetNames.set(id, name);
    }
  }

  return {
    firstMs,
    lastMs,
    units,
    aurasByUnit: model.aurasByUnit,
    castsByUnit,
    hpByUnit,
    powerByUnit,
    deaths,
    spellNames,
    importantBuffIds,
    bookmarks,
    targetNames,
    timeline,
    avoidableHits,
    encounters,
    dmgByUnit,
    healByUnit,
    incomingByUnit,
    cooldownsByUnit,
    dispellableBySpell,
    dangerousDebuffs,
    dmgDoneByUnit,
    healDoneByUnit,
    capacityByUnit,
  };
}

function strDetail(store: ColumnStore, i: number, key: string): string | undefined {
  const v = store.detail(i, key);
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/** True when a string is a raw WoW GUID (nil `0000…` or a typed `Creature-/Player-/…` id) rather
 *  than a display name — used to suppress GUID fallbacks in `nameOf`. Real unit names never match. */
const GUID_PREFIX = /^(Player|Creature|Pet|Vehicle|GameObject|BattlePet|Item|Cast|Object|Vignette)-/;
function looksLikeGuid(s: string): boolean {
  return GUID_PREFIX.test(s) || /^0+$/.test(s);
}

export type JournalEventKind = 'cast' | 'aura-applied' | 'aura-removed' | 'damage-taken';
export interface JournalEvent {
  kind: JournalEventKind;
  ms: number;
  spellId: number;
  /** aura events only */
  auraType?: AuraKind;
  /** cast events only */
  result?: CastResult;
  /** cast events: target unit id (omitted when self-cast or no target) */
  targetUnit?: number;
  /** cast: effective value produced (enemy damage / ally healing); damage-taken: damage landed. */
  amount?: number;
  /** damage-taken events: enemy source unit id (omitted when unresolved). */
  sourceUnit?: number;
  /** damage-taken events: portion absorbed by a shield on the same hit(s). */
  absorbed?: number;
}

/** Client-side queryable replay state, built from transferred ReplayModelData. Pure function of T:
 *  the viewer sets a clock and reads HP / auras / casts / kill feed at that instant. No store needed. */
export class ReplayView {
  private readonly nameById: Map<number, string>;
  private readonly importantBuffs: Set<number>;
  private readonly gcdById: Map<number, number>;
  constructor(private readonly data: ReplayModelData) {
    this.nameById = new Map(data.units.map((u) => [u.unitId, u.name]));
    this.importantBuffs = new Set(data.importantBuffIds);
    this.gcdById = new Map(data.units.flatMap((u) => (u.gcdMs !== undefined ? [[u.unitId, u.gcdMs] as [number, number]] : [])));
  }

  /** Resolve a unit id to its display name. Returns undefined for unknown units AND for raw GUID
   *  fallbacks (the nil-GUID `0000…`, or `Creature-/Player-/…` when an actor had no name) — callers
   *  treat undefined as "no target to show" (e.g. a no-target cast like Algeth'ar Puzzle), so a GUID
   *  never leaks into "spell → target". */
  nameOf(unitId: number): string | undefined {
    const name = this.nameById.get(unitId) ?? this.data.targetNames.get(unitId);
    return name && !looksLikeGuid(name) ? name : undefined;
  }

  /** The player's inferred GCD (ms), or the unhasted base GCD when we couldn't infer one. */
  gcdMsFor(unitId: number): number {
    return this.gcdById.get(unitId) ?? GCD_BASE_MS;
  }

  /** True when a buff belongs in the replay's important lane (vs the muted misc lane). */
  isImportantBuff(spellId: number): boolean {
    return this.importantBuffs.has(spellId);
  }

  /** True when this DEBUFF is curated dangerous (dispellable OR heal-through) — drives the
   *  player-card danger highlight so a healer can see at a glance which debuffs matter. */
  isDangerousDebuff(spellId: number): boolean {
    return this.data.dangerousDebuffs.has(spellId);
  }

  /** Removable categories of a dangerous debuff (e.g. ['magic','snare']); empty when it's a
   *  heal-through (no remover can clear it) — lets the UI distinguish "dispel it" from "heal it". */
  dispelCategoriesOf(spellId: number): string[] {
    return this.data.dispellableBySpell.get(spellId) ?? [];
  }

  /** Scrub-to-able timeline markers (boss start/end, player deaths), ascending by ms. */
  bookmarks(): ReplayBookmark[] {
    return this.data.bookmarks;
  }

  /** Healers with a baked capacity series (for the timeline band + stoplight). */
  healerUnits(): ReplayUnit[] {
    return this.data.units.filter((u) => u.role === 'healer' && this.data.capacityByUnit.has(u.unitId));
  }

  /** The raw per-bucket capacity series (0..1) for a healer, or undefined. */
  capacitySeries(unitId: number): number[] | undefined {
    return this.data.capacityByUnit.get(unitId);
  }

  /** Rolling capacity (0..1) for a healer at clock T — the trailing-CAPACITY_WINDOW_MS average of the
   *  bucket series (the "how maxed out am I right now" stoplight). undefined for non-healers. */
  capacityAt(unitId: number, ms: number): number | undefined {
    const series = this.data.capacityByUnit.get(unitId);
    if (!series) return undefined;
    const { bucketMs, startMs } = this.data.timeline;
    const endB = Math.min(series.length - 1, Math.floor((ms - startMs) / bucketMs));
    if (endB < 0) return 0;
    const winBuckets = Math.max(1, Math.round(CAPACITY_WINDOW_MS / bucketMs));
    const startB = Math.max(0, endB - winBuckets + 1);
    let sum = 0;
    for (let b = startB; b <= endB; b++) sum += series[b]!;
    return sum / (endB - startB + 1);
  }

  /** Live DPS + HPS meters at clock T: each player's cumulative output from run start to T, divided by
   *  elapsed seconds, ranked high→low. Pet damage/healing IS attributed to its owner via
   *  `store.ownerOf` (SPELL_SUMMON map), so pet-heavy specs read correctly — except a permanent pet
   *  summoned before the log started (no SPELL_SUMMON to map it). An approximate replay aid, not a parse. */
  metersAt(t: number): { dps: MeterRow[]; hps: MeterRow[] } {
    const tl = this.data.timeline;
    const elapsedS = Math.max(1, (t - tl.startMs) / 1000);
    const bIdx = Math.max(0, Math.floor((t - tl.startMs) / tl.bucketMs));
    const sumTo = (arr: number[] | undefined): number => {
      if (!arr) return 0;
      let s = 0;
      const end = Math.min(bIdx, arr.length - 1);
      for (let b = 0; b <= end; b++) s += arr[b]!;
      return s;
    };
    const build = (m: Map<number, number[]>): MeterRow[] => {
      const rows: MeterRow[] = [];
      for (const u of this.data.units) {
        if (!u.isPlayer) continue;
        const total = sumTo(m.get(u.unitId));
        if (total > 0) rows.push({ unitId: u.unitId, name: u.name, value: total / elapsedS });
      }
      return rows.sort((a, b) => b.value - a.value);
    };
    return { dps: build(this.data.dmgDoneByUnit), hps: build(this.data.healDoneByUnit) };
  }

  /** Bucketed damage/healing sums over the run (for the timeline graph). */
  timeline(): RunTimeline {
    return this.data.timeline;
  }
  /** Avoidable-mechanic hits on players ("missed mechanics"), ascending by ms. */
  avoidableHits(): AvoidableHit[] {
    return this.data.avoidableHits;
  }
  /** Boss encounter windows (highlighted regions on the timeline). */
  encounters(): EncounterSpan[] {
    return this.data.encounters;
  }
  /** Successful interrupts, derived from interrupted enemy casts, ascending by ms. */
  interrupts(): InterruptEvent[] {
    const out: InterruptEvent[] = [];
    for (const [unit, list] of this.data.castsByUnit) {
      for (const c of list) {
        if (c.result === 'interrupted' && c.interruptedBy !== undefined) {
          out.push({ ms: c.endMs, byUnit: c.interruptedBy, casterUnit: unit, spellId: c.spellId });
        }
      }
    }
    out.sort((a, b) => a.ms - b.ms);
    return out;
  }

  get firstMs(): number {
    return this.data.firstMs;
  }
  get lastMs(): number {
    return this.data.lastMs;
  }
  units(): ReplayUnit[] {
    return this.data.units;
  }
  players(): ReplayUnit[] {
    return this.data.units.filter((u) => u.isPlayer);
  }
  enemies(): ReplayUnit[] {
    return this.data.units.filter((u) => !u.isPlayer);
  }
  spellName(spellId: number): string {
    return this.data.spellNames.get(spellId) ?? `spell:${spellId}`;
  }
  hpAt(unitId: number, ms: number): HpSample | undefined {
    return hpSampleAt(this.data.hpByUnit.get(unitId), ms);
  }

  /** Aggregated incoming damage/heal over the unit's CURRENT activity burst at `ms` (damage and
   *  heal bursts are tracked independently). null when nothing is incoming/lingering. */
  combatAggregate(unitId: number, ms: number): CombatAggregate | null {
    const d = burstSum(this.data.dmgByUnit.get(unitId), ms, (t) => t.amount, (t) => t.absorbed);
    const h = burstSum(this.data.healByUnit.get(unitId), ms, (t) => t.amount);
    if (!d && !h) return null;
    return {
      dmg: d?.total ?? 0,
      absorb: d?.absorb ?? 0,
      heal: h?.total ?? 0,
      hasDmg: d !== null,
      hasHeal: h !== null,
      dmgActive: d?.active ?? false,
      healActive: h?.active ?? false,
    };
  }

  /** Floating combat numbers for the health bar: incoming damage/heal in the last POP_FADE_MS,
   *  merged per POP_MERGE_MS so ticks don't spam. Newest first; each carries its `age` for fade. */
  recentCombat(unitId: number, ms: number, max = 4): CombatPop[] {
    const out: CombatPop[] = [];
    const collect = (events: readonly { ms: number; amount: number }[] | undefined, kind: 'dmg' | 'heal'): void => {
      if (!events) return;
      let lo = 0;
      let hi = events.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (events[mid]!.ms <= ms) lo = mid + 1;
        else hi = mid;
      }
      let group: { ms: number; amount: number } | null = null;
      for (let i = lo - 1; i >= 0 && events[i]!.ms > ms - POP_FADE_MS; i--) {
        const e = events[i]!;
        if (group && group.ms - e.ms <= POP_MERGE_MS) {
          group.amount += e.amount; // merge older tick into the group (anchor stays the newest ms)
        } else {
          if (group) out.push({ kind, amount: group.amount, age: ms - group.ms });
          group = { ms: e.ms, amount: e.amount };
        }
      }
      if (group) out.push({ kind, amount: group.amount, age: ms - group.ms });
    };
    collect(this.data.dmgByUnit.get(unitId), 'dmg');
    collect(this.data.healByUnit.get(unitId), 'heal');
    return out.filter((p) => p.amount > 0).sort((a, b) => a.age - b.age).slice(0, max);
  }

  /** Availability of a player's important cooldowns at `ms` (interrupt first). Empty = none/unknown.
   *  Assumed available from run start (no cast before ms ⇒ ready). */
  cooldownsAt(unitId: number, ms: number): CooldownStatus[] {
    const list = this.data.cooldownsByUnit.get(unitId);
    if (!list) return [];
    return list.map((cd) => {
      const casts = cd.casts;
      let lo = 0;
      let hi = casts.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (casts[mid]! <= ms) lo = mid + 1;
        else hi = mid;
      }
      const prov = cd.provides ? { provides: cd.provides } : {};
      const last = lo - 1;
      if (last < 0) return { spellId: cd.spellId, name: cd.name, kind: cd.kind, ready: true, readyInMs: 0, ...prov };
      const readyInMs = Math.max(0, casts[last]! + cd.cooldownSeconds * 1000 - ms);
      return { spellId: cd.spellId, name: cd.name, kind: cd.kind, ready: readyInMs <= 0, readyInMs, sinceCastMs: ms - casts[last]!, ...prov };
    });
  }

  /** Union of removable categories of dangerous-dispellable DEBUFFs active on ANY player at `ms`.
   *  Drives the dispel-cooldown "needs a dispel now" glow (the healer analog of `interruptWindow`). */
  dispellableCategoriesAt(ms: number): Set<string> {
    const out = new Set<string>();
    for (const u of this.data.units) {
      if (!u.isPlayer) continue;
      for (const a of activeAurasIn(this.data.aurasByUnit.get(u.unitId), ms)) {
        if (a.auraType !== 'DEBUFF') continue;
        const cats = this.data.dispellableBySpell.get(a.spellId);
        if (cats) for (const c of cats) out.add(c);
      }
    }
    return out;
  }

  /** Hold-last resource value at `ms` — only the unit's CURRENTLY ACTIVE power type (the most
   *  recently reported one). Each advanced block reports a single power type, so a form-shifter
   *  (Feral: Energy in cat, Rage in bear) has parallel hold-last series; returning only the type whose
   *  latest sample ≤ ms is the most recent shows the live resource and hides a stale one (the bug:
   *  the old Rage bar lingering at its bear-form value after shifting back to cat). Returned as a
   *  single-element array for the viewer's multi-bar rendering. Undefined when no power data exists. */
  powerAt(unitId: number, ms: number): { powerType: number; current: number; max: number }[] | undefined {
    const byType = this.data.powerByUnit.get(unitId);
    if (!byType) return undefined;
    let best: { powerType: number; current: number; max: number } | undefined;
    let bestMs = -Infinity;
    for (const [powerType, samples] of byType) {
      if (samples.length === 0 || ms < samples[0]!.ms) continue;
      let lo = 0;
      let hi = samples.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (samples[mid]!.ms <= ms) lo = mid + 1;
        else hi = mid;
      }
      const s = samples[lo - 1]!;
      if (s.ms > bestMs) {
        bestMs = s.ms;
        best = { powerType, current: s.current, max: s.max };
      }
    }
    return best ? [best] : undefined;
  }
  aurasAt(unitId: number, ms: number): ActiveAura[] {
    return activeAurasIn(this.data.aurasByUnit.get(unitId), ms);
  }
  castAt(unitId: number, ms: number): CastInterval | null {
    return castInProgressIn(this.data.castsByUnit.get(unitId), ms);
  }
  /**
   * The cast bar to DISPLAY for a player at `ms`: a real in-progress cast, or — failing that — the
   * estimated GCD window of the most recent instant cast (`gcd:true`, so the viewer fades it). A real
   * cast always wins; the GCD bar only fills the gaps so instant abilities still register on the lane.
   * The returned cast's `endMs` is synthesized to `startMs + inferred GCD` so its fill animates.
   */
  playerCastAt(unitId: number, ms: number): { cast: CastInterval; gcd: boolean } | null {
    const real = this.castAt(unitId, ms);
    if (real) return { cast: real, gcd: false };
    const list = this.data.castsByUnit.get(unitId);
    if (!list) return null;
    const gcdMs = this.gcdMsFor(unitId);
    let found: CastInterval | null = null; // latest instant whose GCD window [start, start+gcd) covers ms
    for (const c of list) {
      if (c.startMs > ms) break; // startMs-ascending → nothing later can cover ms
      if (c.instant && ms < c.startMs + gcdMs) found = c;
    }
    if (!found) return null;
    return { cast: { ...found, endMs: found.startMs + gcdMs }, gcd: true };
  }
  /**
 * Per-player combat journal: the last `max` cast completions and important aura events
 * (debuffs + curated important buffs) up to `beforeMs`, sorted ascending (oldest first).
 * Groups aura intervals by (spellId, appliedMs) to emit one applied + one removed event per
 * application run (not one per stack segment).
 */
  playerJournal(unitId: number, beforeMs: number, max = 40, exclude?: Set<number>): JournalEvent[] {
    const events: JournalEvent[] = [];

    // Aura events — group by (spellId, appliedMs) → true apply/remove pair per run.
    const auraList = this.data.aurasByUnit.get(unitId);
    if (auraList) {
      const runs = new Map<string, { first: number; last: number; spellId: number; auraType: AuraKind }>();
      for (const a of auraList) {
        if (a.startMs > beforeMs) break; // sorted by startMs
        if (exclude?.has(a.spellId)) continue;
        const key = `${a.spellId}:${a.appliedMs}`;
        const r = runs.get(key);
        if (!r) {
          runs.set(key, { first: a.appliedMs, last: a.endMs, spellId: a.spellId, auraType: a.auraType });
        } else if (a.endMs > r.last) {
          r.last = a.endMs;
        }
      }
      for (const { first, last, spellId, auraType } of runs.values()) {
        if (auraType !== 'DEBUFF' && !this.isImportantBuff(spellId)) continue;
        events.push({ kind: 'aura-applied', ms: first, spellId, auraType });
        if (last !== Infinity && last <= beforeMs) {
          events.push({ kind: 'aura-removed', ms: last, spellId, auraType });
        }
      }
    }

    // Cast events: all completed casts up to T.
    const castList = this.data.castsByUnit.get(unitId);
    if (castList) {
      for (const c of castList) {
        if (c.startMs > beforeMs) break;
        if (c.endMs > beforeMs || c.result === 'in-progress') continue;
        if (exclude?.has(c.spellId)) continue;
        const target = c.targetUnit !== 0 && c.targetUnit !== unitId ? c.targetUnit : undefined;
        events.push({ kind: 'cast', ms: c.endMs, spellId: c.spellId, result: c.result, targetUnit: target, amount: c.amount });
      }
    }

    // Incoming-damage events (merged per source+spell) — what hit this player. Sorted by ms ⇒ break.
    const incoming = this.data.incomingByUnit.get(unitId);
    if (incoming) {
      for (const h of incoming) {
        if (h.ms > beforeMs) break;
        if (exclude?.has(h.spellId)) continue;
        events.push({ kind: 'damage-taken', ms: h.ms, spellId: h.spellId, amount: h.amount, absorbed: h.absorbed, sourceUnit: h.src });
      }
    }

    events.sort((a, b) => a.ms - b.ms);
    return events.slice(-max);
  }

  /** Distinct spell ids that can appear in ANY player's combat journal (completed casts + important
   *  auras: debuffs + curated important buffs) — the universe for a journal filter UI, with names. */
  /**
   * The universe of spells that can appear in any player journal (completed casts + debuffs + important
   * buffs), for the viewer's filter popup. Spells that share a DISPLAY NAME (rank / talent variants that
   * log under different spell ids but render identically) are COLLAPSED into one row: `id` is a
   * representative and `ids` lists every underlying id, so toggling the row filters them all together.
   */
  journalSpellIds(): { id: number; name: string; ids: number[] }[] {
    const ids = new Set<number>();
    for (const u of this.data.units) {
      if (!u.isPlayer) continue;
      const casts = this.data.castsByUnit.get(u.unitId);
      if (casts) for (const c of casts) if (c.result !== 'in-progress') ids.add(c.spellId);
      const auras = this.data.aurasByUnit.get(u.unitId);
      if (auras) for (const a of auras) if (a.auraType === 'DEBUFF' || this.isImportantBuff(a.spellId)) ids.add(a.spellId);
      const inc = this.data.incomingByUnit.get(u.unitId);
      if (inc) for (const h of inc) ids.add(h.spellId);
    }
    const byName = new Map<string, number[]>();
    for (const id of ids) {
      const name = this.spellName(id);
      (byName.get(name) ?? byName.set(name, []).get(name)!).push(id);
    }
    return [...byName.entries()]
      .map(([name, group]) => {
        const sorted = group.sort((a, b) => a - b);
        return { id: sorted[0]!, name, ids: sorted };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Consolidated enemy cast log: the last `max` completed non-instant enemy casts before
   * `beforeMs` plus any currently in-progress ones. Sorted ascending (completed oldest-first,
   * then in-progress by start). Shows ALL cast-bar spells (not just spell-table interruptibles),
   * so the feed isn't empty when a dungeon has few covered spells.
   */
  enemyCastFeed(beforeMs: number, max = 20): { unit: ReplayUnit; cast: CastInterval }[] {
    const completed: { unit: ReplayUnit; cast: CastInterval; ms: number }[] = [];
    const inProg: { unit: ReplayUnit; cast: CastInterval }[] = [];
    for (const u of this.enemies()) {
      const list = this.data.castsByUnit.get(u.unitId);
      if (!list) continue;
      for (const c of list) {
        if (c.startMs > beforeMs) break;
        if (c.instant) continue; // skip instant procs — only show cast-bar spells
        if (c.endMs > beforeMs) {
          inProg.push({ unit: u, cast: c });
        } else if (c.result !== 'in-progress') {
          completed.push({ unit: u, cast: c, ms: c.endMs });
        }
      }
    }
    completed.sort((a, b) => a.ms - b.ms);
    inProg.sort((a, b) => a.cast.startMs - b.cast.startMs);
    return [...completed.slice(-max).map(({ unit, cast }) => ({ unit, cast })), ...inProg];
  }

  /** Deaths in (a, b] — the kill feed window. */
  deathsBetween(a: number, b: number): ReplayDeath[] {
    return this.data.deaths.filter((d) => d.ms > a && d.ms <= b);
  }

  /**
   * Per-player intervals where HP dropped below `threshold` (default 25%) — for the timeline's
   * "low HP" danger bands. Flags near-misses (a dip, then recovery), not just deaths. An interval
   * that runs into a death is clipped at the death (after that they're a corpse, not "at critical
   * HP"); a still-low interval at the end runs to the run end. Walks the hold-last HP samples.
   */
  criticalWindows(threshold = 0.25): { unitId: number; name: string; windows: { startMs: number; endMs: number }[] }[] {
    const deathsByUnit = new Map<number, number[]>();
    for (const d of this.data.deaths) {
      if (!d.isPlayer) continue;
      (deathsByUnit.get(d.unitId) ?? deathsByUnit.set(d.unitId, []).get(d.unitId)!).push(d.ms);
    }
    for (const arr of deathsByUnit.values()) arr.sort((a, b) => a - b);

    const out: { unitId: number; name: string; windows: { startMs: number; endMs: number }[] }[] = [];
    for (const u of this.players()) {
      const samples = this.data.hpByUnit.get(u.unitId);
      if (!samples || samples.length === 0) continue;
      const deaths = deathsByUnit.get(u.unitId) ?? [];
      const windows: { startMs: number; endMs: number }[] = [];
      let di = 0;
      let open: number | null = null;
      let dead = false;
      for (const s of samples) {
        // Close any open dip AT a death and mark the player dead — a corpse sits at 0 HP (often for a
        // long time waiting on a battle-rez), and those samples are < threshold but must NOT be flagged
        // as "at critical HP" (or reopen a window). Advance unconditionally so a one-shot death (no open
        // window) still marks dead, instead of the corpse samples opening an unguarded band.
        while (di < deaths.length && deaths[di]! <= s.ms) {
          if (open !== null && deaths[di]! >= open) {
            windows.push({ startMs: open, endMs: deaths[di]! });
            open = null;
          }
          dead = true;
          di++;
        }
        // HP back above 0 ⇒ revived; resume flagging (a rez at low HP legitimately opens a new window).
        if (dead && s.currentHp > 0) dead = false;
        if (dead) continue;

        const frac = s.maxHp > 0 ? s.currentHp / s.maxHp : 1;
        const low = frac < threshold;
        if (low && open === null) open = s.ms;
        else if (!low && open !== null) {
          windows.push({ startMs: open, endMs: s.ms });
          open = null;
        }
      }
      if (open !== null) {
        const d = deaths.find((x) => x >= open!);
        windows.push({ startMs: open, endMs: d ?? this.lastMs });
      }
      if (windows.length) out.push({ unitId: u.unitId, name: u.name, windows });
    }
    return out;
  }
  /** Approximate GCD remaining fraction (0 = idle/off-GCD) — every cast START/instant triggers the
   *  global cooldown. The window length is the player's INFERRED GCD (inferGcdMs, baked per unit),
   *  falling back to the unhasted base; still approximate since per-moment haste isn't known. */
  gcdRemaining(unitId: number, ms: number, gcdMs = this.gcdMsFor(unitId)): number {
    const list = this.data.castsByUnit.get(unitId);
    if (!list) return 0;
    let lastStart = -Infinity;
    for (const c of list) {
      if (c.startMs > ms) break;
      if (c.startMs > lastStart) lastStart = c.startMs;
    }
    const since = ms - lastStart;
    return since >= 0 && since < gcdMs ? (gcdMs - since) / gcdMs : 0;
  }
  /** Interruptible enemy casts in progress at `ms`, OR ended within `tailMs` with a DEFINITIVE
   *  outcome (interrupted / went-off) so that result stays briefly visible. Casts that just stopped
   *  — cancelled (caster died mid-cast) or never-resolved in-progress — drop the moment they end,
   *  so they don't linger or pile up when scrubbing forward. The dangerous-cast lane.
   *
   *  Inclusion is NOT purely table-driven: a cast counts if it's flagged `interruptible` by the spell
   *  table OR it was actually INTERRUPTED in the log (proven interruptible by gameplay). That keeps the
   *  pane useful on dungeons with thin MDT seed coverage — a cast the party kicked still shows here,
   *  not just in the all-casts feed. */
  enemyCastsAround(ms: number, tailMs = 3000): { unit: ReplayUnit; cast: CastInterval }[] {
    const out: { unit: ReplayUnit; cast: CastInterval }[] = [];
    for (const u of this.enemies()) {
      const list = this.data.castsByUnit.get(u.unitId);
      if (!list) continue;
      for (const c of list) {
        if (c.startMs > ms) break;
        if (!c.interruptible && c.result !== 'interrupted') continue;
        const inProgress = ms < c.endMs && c.endMs > c.startMs;
        const outcomeVisible =
          ms >= c.endMs && ms - c.endMs <= tailMs && (c.result === 'interrupted' || c.result === 'success');
        if (inProgress || outcomeVisible) out.push({ unit: u, cast: c });
      }
    }
    return out;
  }
}
