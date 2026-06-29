import type { Analytic, AnalyticContext } from '../types.js';
import { SpellTable } from '../../spells/spellTable.js';
import { msRangeOf } from './helpers.js';
import { aggregate, type AggregateStats } from '../stats/aggregate.js';
import { cooldownsForSpec, IMPORTANT_COOLDOWNS } from '../../spells/importantCooldowns.js';

// ---------------------------------------------------------------------------
// Cleanse / removal analytic. Generalizes #6 dispels: scores EVERY dangerous debuff with a
// non-empty removableBy (schools AND mechanics), because mechanic removals (Tiger's Lust, Swift
// Art, Blessing of Freedom, …) fire a clean SPELL_DISPEL with extraSpellId just like a school
// dispel — VERIFIED from logs. Detection is therefore uniform via SPELL_DISPEL; only
// healing-absorbs (logSignature 'heal-through') are handled separately (healed off, not dispelled).
//
// For each enemy-applied dangerous DEBUFF on a player in range:
//   - heal-through-only (every removableBy category is healing-absorb): tracked in `healThrough`
//     (cleared before its DB2 duration = healed off).
//   - otherwise: removed or missed. A miss is further classified by whether the PARTY actually had a
//     remover and whether it was AVAILABLE during the debuff's window (see below).
//
// Two removal SIGNALS, because not every remover fires a SPELL_DISPEL:
//   (1) DISPEL — an active breaker (Tiger's Lust, Swift Art, a school dispel, …) emits a SPELL_DISPEL
//       naming the removed aura via extraSpellId. Clean to score.
//   (2) IMMUNITY-CLEAR — an immunity BUFF (Blessing of Freedom, …) strips a snare/root as a side effect
//       of its movement-impair immunity, logging ONLY a plain SPELL_AURA_REMOVED on the debuff (no
//       SPELL_DISPEL, and the removed event's source is still the mob, so it's not attributable from
//       the removed line). VERIFIED: a paladin's BoF clearing Chains of Subjugation 32× in a real log
//       produced zero SPELL_DISPELs — every clear was invisible and miscounted as "missed". We detect
//       it by correlation: a known remover buff applied to a player at ~the same instant (≤
//       IMMUNITY_CLEAR_TOLERANCE_MS) as the debuff's removal, whose provides ∩ removableBy ≠ ∅. The
//       DISPEL signal is checked first, so active dispel-removers never reach this path (no double count).
//
// MISS CLASSIFICATION (the "could it have been removed?" model a healer asks). For a missed removable
// debuff we look at the removers the PARTY actually brought (from COMBATANT_INFO specs + removers seen
// used) that can clear it, and model their cooldowns from observed use times (assumed off-CD at run
// start, like the interrupt-accountability model):
//   - missedFixable        — a party remover was OFF COOLDOWN at some point during the debuff's window,
//                            so it could have been removed if played differently (the unused tool(s) are
//                            named in `unusedRemovers` + per-debuff `removerCandidates`).
//   - missedCooldownBlocked — the party HAD a remover but every copy was ON COOLDOWN for the whole
//                            window (e.g. a single 8s dispel already spent on a sibling debuff) — a
//                            forced heal-through, not a play mistake.
// A remover with no known cooldown, or one the party brought but never used, is treated as available
// (conservative — we never falsely blame a cooldown). Cooldowns are BASE values (haste/talents shorten
// some), so the split is approximate.
// ---------------------------------------------------------------------------

// A remover-buff application and a same-instant debuff removal on the same player are treated as causal
// when within this window (the two events share a millisecond in practice; the slack absorbs log jitter).
const IMMUNITY_CLEAR_TOLERANCE_MS = 150;
// Jitter slack when modelling a remover's cooldown coverage, so a sibling debuff dispelled at the SAME
// instant a debuff is applied counts the remover as already-spent at this window's start.
const REMOVER_USE_TOLERANCE_MS = 250;

export interface RemoverRef {
  spellId: number;
  name: string;
}
export interface RemovalByDebuff {
  spellId: number;
  name: string;
  applied: number;
  removed: number;
  missed: number;
  missedRemovable: number;
  /** missed while a party remover was available during the window (could've been removed). */
  missedFixable: number;
  /** missed only because every party remover was on cooldown the whole window (forced heal-through). */
  missedCooldownBlocked: number;
  /** total seconds this debuff was active across all its applications. */
  activeSeconds: number;
  /** seconds of this debuff's uptime that could've been trimmed if a remover had been used when first
   *  available (summed over fixable misses) — the improvement opportunity. */
  removableSeconds: number;
  /** party removers (brought via spec or seen used) that CAN clear this debuff. */
  removerCandidates: RemoverRef[];
  latency: AggregateStats;
}
export interface RemovalByRemover {
  spellId: number;
  name: string;
  count: number;
}
export interface HealThroughByDebuff {
  spellId: number;
  name: string;
  applied: number;
  clearedEarly: number;
}
export interface RemovalResult {
  overall: {
    applied: number;
    removed: number;
    missed: number;
    missedRemovable: number;
    /** missed but a party remover was available during the window (play-differently). */
    missedFixable: number;
    /** missed because the only party removers were on cooldown the whole window. */
    missedCooldownBlocked: number;
    healThrough: number;
    /** total seconds removable dangerous debuffs were active (summed across applications). */
    activeSeconds: number;
    /** of `activeSeconds`, the time spent on debuffs that were never removed. */
    missedSeconds: number;
    /** of `missedSeconds`, the time where every party remover was on cooldown. */
    missedCooldownBlockedSeconds: number;
    /** debuff uptime that could've been trimmed had removers been used when available (the opportunity). */
    removableSeconds: number;
  };
  byDebuff: RemovalByDebuff[];
  byRemover: RemovalByRemover[];
  /** removers that were AVAILABLE but unused on fixable misses — count = misses each could've cleared. */
  unusedRemovers: RemovalByRemover[];
  healThrough: HealThroughByDebuff[];
  coverageNote: string;
}

const COVERAGE_NOTE =
  'Scores dangerous debuffs with known removal categories (DB2 ∪ curation). Removal is detected via ' +
  'SPELL_DISPEL (active breakers + school dispels) OR via an immunity buff (e.g. Blessing of Freedom) ' +
  'applied as the debuff is stripped. A miss is "cooldown-blocked" only when every party remover that ' +
  'could clear it was on cooldown for the whole window (base cooldowns, so approximate); otherwise it ' +
  'was removable if played differently. Healing-absorbs are tracked separately (heal-through). Accuracy ' +
  'is bounded by spell-table coverage; un-curated debuffs are not scored.';

interface DebuffAcc {
  name: string;
  applied: number;
  removed: number;
  missed: number;
  missedRemovable: number;
  missedFixable: number;
  missedCooldownBlocked: number;
  activeMs: number;
  removableMs: number;
  candidateIds: Set<number>;
  latencies: number[];
}
interface HealAcc {
  name: string;
  applied: number;
  clearedEarly: number;
}

const cdMsOf = (removerId: number): number => (IMPORTANT_COOLDOWNS[removerId]?.cooldownSeconds ?? 0) * 1000;

/** The EARLIEST ms in [start, end) at which a remover with this use timeline was OFF COOLDOWN, or
 *  Infinity if it was on cooldown the whole window. Uses are ms-sorted; each spends the remover for
 *  `cdMs` (with a small leading tolerance for log jitter). The gap from this time to the debuff's end
 *  is the uptime that COULD have been trimmed if the remover had been used then. */
function earliestAvailableInWindow(uses: number[], cdMs: number, start: number, end: number): number {
  if (cdMs <= 0) return start < end ? start : Infinity; // unknown / no cooldown ⇒ available from the start
  let cursor = start;
  for (const u of uses) {
    const coverFrom = u - REMOVER_USE_TOLERANCE_MS;
    const coverTo = u + cdMs;
    if (coverTo <= cursor) continue; // already past this use's coverage
    if (coverFrom > cursor) return cursor; // uncovered gap begins at cursor ⇒ available there
    cursor = coverTo; // extend coverage
    if (cursor >= end) return Infinity; // covered through the end of the window
  }
  return cursor < end ? cursor : Infinity; // uncovered tail begins at cursor
}

export function computeRemoval(
  store: AnalyticContext['store'],
  table: SpellTable,
  range: { startMs: number; endMs: number },
  pcts: number[] = [50, 95],
): RemovalResult {
  const appliedId = store.eventTypeId('SPELL_AURA_APPLIED');
  const removedId = store.eventTypeId('SPELL_AURA_REMOVED');
  const dispelId = store.eventTypeId('SPELL_DISPEL');
  const ciId = store.eventTypeId('COMBATANT_INFO');

  // Whole-log indices (episodes are filtered to range by apply time).
  const dispelsByPlayer = new Map<number, { ms: number; removed: number; remover: number }[]>();
  const removedByKey = new Map<string, number[]>();
  // Immunity-buff applications per player (known removers applied AS A BUFF) — the signal for clears
  // that fire no SPELL_DISPEL. Pushed in store (time) order ⇒ each list is ms-sorted.
  const removerBuffsByPlayer = new Map<number, { ms: number; remover: number }[]>();
  // Remover USE timeline by (removerId → casterId → ms[]) for cooldown modelling. A dispel use = the
  // SPELL_DISPEL cast; an immunity-remover use = casting the buff. Both spend the caster's cooldown.
  const removerUses = new Map<number, Map<number, number[]>>();
  const pushUse = (removerId: number, casterId: number, ms: number) => {
    let byCaster = removerUses.get(removerId);
    if (!byCaster) removerUses.set(removerId, (byCaster = new Map()));
    let list = byCaster.get(casterId);
    if (!list) byCaster.set(casterId, (list = []));
    list.push(ms);
  };
  // Removers the PARTY brings: from each player's spec (COMBATANT_INFO) + any remover seen used.
  const partyRemoverIds = new Set<number>();

  for (let i = 0; i < store.count; i++) {
    const et = store.eventType[i]!;
    if (et === dispelId) {
      if (store.detail(i, 'auraType') !== 'DEBUFF') continue; // cleanses only, not offensive buff-purges
      const unit = store.targetGuid[i]!;
      if (!store.isPlayer(unit)) continue;
      const removed = store.detailNumber(i, 'extraSpellId');
      if (removed === undefined) continue;
      const remover = store.spellIdNum(i) ?? 0;
      (dispelsByPlayer.get(unit) ?? dispelsByPlayer.set(unit, []).get(unit)!).push({ ms: store.ts[i]!, removed, remover });
      if (remover !== 0) pushUse(remover, store.sourceGuid[i]!, store.ts[i]!);
    } else if (et === removedId) {
      const unit = store.targetGuid[i]!;
      if (!store.isPlayer(unit)) continue;
      const key = `${unit}:${store.spellId[i]!}`;
      (removedByKey.get(key) ?? removedByKey.set(key, []).get(key)!).push(store.ts[i]!);
    } else if (et === appliedId) {
      const remover = store.spellId[i]!;
      if (!table.isRemover(remover)) continue; // only known removers
      if (store.detail(i, 'auraType') !== 'BUFF') continue; // the remover lands as a buff on the player
      const unit = store.targetGuid[i]!;
      if (!store.isPlayer(unit)) continue;
      (removerBuffsByPlayer.get(unit) ?? removerBuffsByPlayer.set(unit, []).get(unit)!).push({ ms: store.ts[i]!, remover });
      pushUse(remover, store.sourceGuid[i]!, store.ts[i]!); // caster spent the buff's cooldown
    } else if (et === ciId) {
      const t = store.ts[i]!;
      if (t < range.startMs || t >= range.endMs) continue;
      const specId = store.detailNumber(i, 'specId');
      if (specId === undefined) continue;
      for (const cd of cooldownsForSpec(specId)) if (table.isRemover(cd.spellId)) partyRemoverIds.add(cd.spellId);
    }
  }
  for (const r of removerUses.keys()) partyRemoverIds.add(r); // anything actually used, the party clearly had

  // Party removers that can clear a given debuff (cached per debuff spell id).
  const candidateCache = new Map<number, number[]>();
  const candidatesFor = (debuff: number): number[] => {
    let c = candidateCache.get(debuff);
    if (!c) candidateCache.set(debuff, (c = [...partyRemoverIds].filter((r) => table.canRemove(r, debuff))));
    return c;
  };
  const removerName = (id: number): string => store.spellName(id) || IMPORTANT_COOLDOWNS[id]?.name || table.get(id)?.name || `spell:${id}`;

  // An immunity clear: a remover buff applied to `unit` within tolerance of the debuff's removal whose
  // provides ∩ the debuff's removableBy ≠ ∅. Returns the remover spell id, or undefined.
  const immunityClearer = (unit: number, spell: number, removedMs: number): number | undefined =>
    removerBuffsByPlayer
      .get(unit)
      ?.find((b) => Math.abs(b.ms - removedMs) <= IMMUNITY_CLEAR_TOLERANCE_MS && table.canRemove(b.remover, spell))?.remover;

  const byDebuff = new Map<number, DebuffAcc>();
  const byRemover = new Map<number, number>();
  const unusedRemovers = new Map<number, number>();
  const healThrough = new Map<number, HealAcc>();
  const overall = {
    applied: 0, removed: 0, missed: 0, missedRemovable: 0, missedFixable: 0, missedCooldownBlocked: 0,
    healThrough: 0, activeMs: 0, missedActiveMs: 0, missedCooldownBlockedMs: 0, removableMs: 0,
  };

  const isHealThrough = (cat: string) => table.removalCategory(cat)?.logSignature === 'heal-through';

  for (let i = 0; i < store.count; i++) {
    if (store.eventType[i] !== appliedId) continue;
    const src = store.sourceGuid[i]!;
    if (src === 0 || store.isPlayer(src)) continue; // enemy-applied only
    const unit = store.targetGuid[i]!;
    if (!store.isPlayer(unit)) continue;
    if (store.detail(i, 'auraType') !== 'DEBUFF') continue;
    const spell = store.spellId[i]!;
    if (!table.isDangerousDebuff(spell)) continue;
    const cats = table.removableCategoriesOf(spell);
    if (cats.length === 0) continue; // dangerous but nothing removes it (heal-through-by-damage)
    const applyMs = store.ts[i]!;
    if (applyMs < range.startMs || applyMs >= range.endMs) continue;

    const name = table.get(spell)?.name ?? store.spellName(spell) ?? `spell:${spell}`;
    const durMs = (table.get(spell)?.durationSeconds ?? 0) * 1000;

    // Heal-through-only (all categories are healing-absorb): healed off, not dispelled.
    if (cats.every(isHealThrough)) {
      overall.healThrough++;
      const acc = healThrough.get(spell) ?? healThrough.set(spell, { name, applied: 0, clearedEarly: 0 }).get(spell)!;
      acc.applied++;
      if (durMs > 0) {
        const removals = removedByKey.get(`${unit}:${spell}`);
        if (removals?.some((r) => r > applyMs && r < applyMs + durMs - 250)) acc.clearedEarly++;
      }
      continue;
    }

    const acc =
      byDebuff.get(spell) ??
      byDebuff
        .set(spell, {
          name, applied: 0, removed: 0, missed: 0, missedRemovable: 0, missedFixable: 0,
          missedCooldownBlocked: 0, activeMs: 0, removableMs: 0, candidateIds: new Set<number>(), latencies: [],
        })
        .get(spell)!;
    acc.applied++;
    overall.applied++;

    const dispels = dispelsByPlayer.get(unit);
    const nextDispel = dispels?.find((d) => d.ms > applyMs && d.removed === spell);
    const removals = removedByKey.get(`${unit}:${spell}`);
    const nextRemoved = removals?.find((r) => r > applyMs);

    // Resolve how (and when) this episode ended: a DISPEL, an immunity-clear, natural expiry, or run end.
    let endMs: number;
    let removerUsed: number | undefined;
    if (nextDispel && (nextRemoved === undefined || nextDispel.ms <= nextRemoved)) {
      removerUsed = nextDispel.remover; // (1) DISPEL signal
      endMs = nextDispel.ms;
    } else {
      const immRemover = nextRemoved !== undefined ? immunityClearer(unit, spell, nextRemoved) : undefined;
      if (immRemover !== undefined) {
        removerUsed = immRemover; // (2) IMMUNITY-CLEAR signal
        endMs = nextRemoved!;
      } else {
        endMs = nextRemoved ?? (durMs > 0 ? applyMs + durMs : range.endMs); // missed: natural expiry/run end
      }
    }
    endMs = Math.min(endMs, range.endMs);
    const activeMs = Math.max(0, endMs - applyMs);
    acc.activeMs += activeMs;
    overall.activeMs += activeMs;

    if (removerUsed !== undefined) {
      acc.removed++;
      acc.latencies.push(endMs - applyMs);
      overall.removed++;
      byRemover.set(removerUsed, (byRemover.get(removerUsed) ?? 0) + 1);
      continue;
    }

    // Missed. Classify by what the party could have done.
    acc.missed++;
    overall.missed++;
    overall.missedActiveMs += activeMs;
    if (table.removersForDebuff(spell).length > 0) {
      acc.missedRemovable++;
      overall.missedRemovable++;
    }

    const cands = candidatesFor(spell);
    for (const r of cands) acc.candidateIds.add(r);
    if (cands.length) {
      // Earliest any party remover could have cleared this debuff (Infinity ⇒ all on CD all window).
      let earliest = Infinity;
      const available: number[] = [];
      for (const r of cands) {
        const byCaster = removerUses.get(r);
        let e: number;
        if (!byCaster) {
          e = applyMs; // party brought it (spec) but never used it ⇒ available from window start
        } else {
          e = Infinity;
          const cd = cdMsOf(r);
          for (const uses of byCaster.values()) e = Math.min(e, earliestAvailableInWindow(uses, cd, applyMs, endMs));
        }
        if (e !== Infinity) {
          available.push(r);
          earliest = Math.min(earliest, e);
        }
      }
      if (earliest !== Infinity) {
        acc.missedFixable++;
        overall.missedFixable++;
        // Uptime that could have been trimmed: from first availability to the debuff's actual end.
        const savableMs = Math.max(0, endMs - earliest);
        acc.removableMs += savableMs;
        overall.removableMs += savableMs;
        for (const r of available) unusedRemovers.set(r, (unusedRemovers.get(r) ?? 0) + 1);
      } else {
        acc.missedCooldownBlocked++;
        overall.missedCooldownBlocked++;
        overall.missedCooldownBlockedMs += activeMs;
      }
    }
  }

  const toSec = (ms: number) => Math.round(ms / 1000);

  const byDebuffOut: RemovalByDebuff[] = [...byDebuff.entries()]
    .map(([spellId, a]) => ({
      spellId,
      name: a.name,
      applied: a.applied,
      removed: a.removed,
      missed: a.missed,
      missedRemovable: a.missedRemovable,
      missedFixable: a.missedFixable,
      missedCooldownBlocked: a.missedCooldownBlocked,
      activeSeconds: toSec(a.activeMs),
      removableSeconds: toSec(a.removableMs),
      removerCandidates: [...a.candidateIds].map((id) => ({ spellId: id, name: removerName(id) })).sort((x, y) => x.name.localeCompare(y.name)),
      latency: aggregate(a.latencies, pcts),
    }))
    .sort((x, y) => y.applied - x.applied);

  const byRemoverOut: RemovalByRemover[] = [...byRemover.entries()]
    .map(([spellId, count]) => ({ spellId, name: removerName(spellId), count }))
    .sort((x, y) => y.count - x.count);

  const unusedRemoversOut: RemovalByRemover[] = [...unusedRemovers.entries()]
    .map(([spellId, count]) => ({ spellId, name: removerName(spellId), count }))
    .sort((x, y) => y.count - x.count);

  const healThroughOut: HealThroughByDebuff[] = [...healThrough.entries()]
    .map(([spellId, a]) => ({ spellId, name: a.name, applied: a.applied, clearedEarly: a.clearedEarly }))
    .sort((x, y) => y.applied - x.applied);

  return {
    overall: {
      applied: overall.applied,
      removed: overall.removed,
      missed: overall.missed,
      missedRemovable: overall.missedRemovable,
      missedFixable: overall.missedFixable,
      missedCooldownBlocked: overall.missedCooldownBlocked,
      healThrough: overall.healThrough,
      activeSeconds: toSec(overall.activeMs),
      missedSeconds: toSec(overall.missedActiveMs),
      missedCooldownBlockedSeconds: toSec(overall.missedCooldownBlockedMs),
      removableSeconds: toSec(overall.removableMs),
    },
    byDebuff: byDebuffOut,
    byRemover: byRemoverOut,
    unusedRemovers: unusedRemoversOut,
    healThrough: healThroughOut,
    coverageNote: COVERAGE_NOTE,
  };
}

export const removal: Analytic<RemovalResult> = {
  id: 'removal.cleanse',
  title: 'Cleanse / Removal',
  role: 'all',
  columns: ['eventType', 'source', 'target', 'spell', 'side', 'ts'],
  summary: false,
  run(ctx) {
    return computeRemoval(ctx.store, ctx.spellTable ?? SpellTable.empty(), msRangeOf(ctx));
  },
};
