import type { Analytic, AnalyticContext } from '../types.js';
import { Primitives } from '../primitives/index.js';
import { msRangeOf } from './helpers.js';
import { DAMAGE_EVENT_NAMES } from '../../columns/schema.js';
import { CLUTCH_ABILITIES, type ClutchKind } from '../../spells/clutchAbilities.js';

// ---------------------------------------------------------------------------
// Clutch plays — high-value external/utility casts that helped an ally survive, praised regardless of
// the caster's role. The counterpart to interrupt/avoidable accountability: surface what players did
// RIGHT. A curated ability (clutchAbilities.ts) only COUNTS as clutch when the protected ally was
// actually in danger, so routine/pre-emptive casts on a healthy target aren't flattered:
//   • reactive  — the ally was at/below CLUTCH_HP_FRAC of max HP when the cast landed, OR
//   • proactive — the ally weathered ≥ DANGER_DMG_FRAC of their max HP in the window while protected.
// A "life saved" is the strongest call-out: the ally was critically low (≤ CRITICAL_HP_FRAC) and did
// not die within SURVIVE_WINDOW_MS.
//
// All heuristic: HP is the hold-last reconstruction; damage weathered is the ally's incoming during a
// fixed window (a proxy for the external's value, not the exact mitigated amount); positional value of
// a pull (Leap of Faith / Rescue) isn't in the log, so pulls are credited only on the HP signal.
// ---------------------------------------------------------------------------

export const CLUTCH_WINDOW_MS = 6000; // damage-weathered window after the cast
export const SURVIVE_WINDOW_MS = 8000; // "saved" requires the ally to live this long after
export const CLUTCH_HP_FRAC = 0.45; // reactive trigger: ally at/below this HP fraction
export const CRITICAL_HP_FRAC = 0.2; // life-saved trigger
export const DANGER_DMG_FRAC = 0.5; // proactive trigger: weathered ≥ this fraction of max HP

export interface ClutchPlay {
  ms: number;
  casterId: number;
  casterName: string;
  targetId: number;
  targetName: string;
  spellId: number;
  spellName: string;
  kind: ClutchKind;
  /** Target HP fraction (0..1) when the cast landed; null when no HP reconstruction for the target. */
  targetHpFraction: number | null;
  /** Damage the target took in the window after the cast (value proxy for a DR external). */
  damageWeathered: number;
  survived: boolean;
  lifeSaved: boolean;
}

export interface ClutchCaster {
  id: number;
  name: string;
  plays: number;
  lifeSaved: number;
}

export interface ClutchResult {
  /** Clutch plays only (the danger gate passed), highest-value first. */
  plays: ClutchPlay[];
  byCaster: ClutchCaster[];
  coverageNote: string;
}

const COVERAGE_NOTE =
  'A curated external/utility ability counts as "clutch" only when the protected ally was in real ' +
  'danger — at/below 45% HP, or weathering ≥50% of their max HP within 6s of the cast. "Saved" = the ' +
  'ally was ≤20% HP and lived ≥8s. Heuristic: HP is the hold-last reconstruction and damage weathered ' +
  'is a value proxy, not the exact mitigated amount; a pull\'s positional value (Leap of Faith / Rescue) ' +
  "isn't in the log, so pulls are credited on the HP signal only. Bounded by the curated ability list.";

export function computeClutchPlays(
  store: AnalyticContext['store'],
  prim: Primitives,
  range: { startMs: number; endMs: number },
): ClutchResult {
  const appliedId = store.eventTypeId('SPELL_AURA_APPLIED');
  const castId = store.eventTypeId('SPELL_CAST_SUCCESS');
  const diedId = store.eventTypeId('UNIT_DIED');
  const dmgIds = store.eventTypeIds(DAMAGE_EVENT_NAMES);
  const hp = prim.hpTimeline();

  // Whole-store indexes (a play's window can extend past range end; HP/deaths need full history).
  const dmgByTarget = new Map<number, { ms: number; amt: number }[]>();
  const deathsByPlayer = new Map<number, number[]>();
  interface Candidate { ms: number; spellId: number; caster: number; target: number; kind: ClutchKind; name: string }
  const candidates: Candidate[] = [];

  for (let i = 0; i < store.count; i++) {
    const et = store.eventType[i]!;
    const ms = store.ts[i]!;

    if (dmgIds.has(et)) {
      const tgt = store.targetGuid[i]!;
      if (store.isPlayer(tgt)) {
        const amt = store.amount[i] ?? 0;
        if (amt > 0) (dmgByTarget.get(tgt) ?? dmgByTarget.set(tgt, []).get(tgt)!).push({ ms, amt });
      }
      continue;
    }
    if (et === diedId) {
      const tgt = store.targetGuid[i]!;
      if (store.isPlayer(tgt)) (deathsByPlayer.get(tgt) ?? deathsByPlayer.set(tgt, []).get(tgt)!).push(ms);
      continue;
    }
    if (et === appliedId || et === castId) {
      const ab = CLUTCH_ABILITIES[store.spellId[i]!];
      if (!ab) continue;
      if (ab.detect === 'aura' ? et !== appliedId : et !== castId) continue;
      const caster = store.sourceGuid[i]!;
      const target = store.targetGuid[i]!;
      if (!store.isPlayer(caster) || !store.isPlayer(target) || caster === target) continue; // external help only
      if (ms < range.startMs || ms >= range.endMs) continue;
      candidates.push({ ms, spellId: store.spellId[i]!, caster, target, kind: ab.kind, name: ab.name });
    }
  }

  const plays: ClutchPlay[] = [];
  for (const c of candidates) {
    const q = hp.hpAt(c.target, c.ms);
    const frac = q ? q.fraction : null;
    const maxHp = q?.maxHp ?? 0;

    const series = dmgByTarget.get(c.target);
    let weathered = 0;
    if (series) {
      const hi = c.ms + CLUTCH_WINDOW_MS;
      for (let j = lowerBound(series, c.ms); j < series.length && series[j]!.ms <= hi; j++) weathered += series[j]!.amt;
    }

    const lowHp = frac !== null && frac <= CLUTCH_HP_FRAC;
    const heavyDmg = maxHp > 0 && weathered >= DANGER_DMG_FRAC * maxHp;
    if (!lowHp && !heavyDmg) continue; // not actually clutch — don't flatter a routine cast

    const deaths = deathsByPlayer.get(c.target);
    const survived = !deaths || !deaths.some((d) => d >= c.ms && d <= c.ms + SURVIVE_WINDOW_MS);
    const lifeSaved = frac !== null && frac <= CRITICAL_HP_FRAC && survived;

    plays.push({
      ms: c.ms,
      casterId: c.caster,
      casterName: store.actorName(c.caster) || `#${c.caster}`,
      targetId: c.target,
      targetName: store.actorName(c.target) || `#${c.target}`,
      spellId: c.spellId,
      spellName: c.name,
      kind: c.kind,
      targetHpFraction: frac,
      damageWeathered: Math.round(weathered),
      survived,
      lifeSaved,
    });
  }

  // Highest-value first: lives saved, then lowest HP at cast, then most damage weathered.
  plays.sort(
    (a, b) =>
      Number(b.lifeSaved) - Number(a.lifeSaved) ||
      (a.targetHpFraction ?? 1) - (b.targetHpFraction ?? 1) ||
      b.damageWeathered - a.damageWeathered,
  );

  const casters = new Map<number, ClutchCaster>();
  for (const p of plays) {
    const c = casters.get(p.casterId) ?? casters.set(p.casterId, { id: p.casterId, name: p.casterName, plays: 0, lifeSaved: 0 }).get(p.casterId)!;
    c.plays++;
    if (p.lifeSaved) c.lifeSaved++;
  }
  const byCaster = [...casters.values()].sort((a, b) => b.lifeSaved - a.lifeSaved || b.plays - a.plays);

  return { plays, byCaster, coverageNote: COVERAGE_NOTE };
}

/** First index `j` with `arr[j].ms >= target` (arr is ms-sorted). */
function lowerBound(arr: { ms: number }[], target: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid]!.ms < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export const clutchPlays: Analytic<ClutchResult> = {
  id: 'utility.clutch',
  title: 'Clutch Plays',
  role: 'all',
  columns: ['eventType', 'source', 'target', 'spell', 'ts', 'amount'],
  summary: false,
  run(ctx) {
    return computeClutchPlays(ctx.store, Primitives.for(ctx.store), msRangeOf(ctx));
  },
};
