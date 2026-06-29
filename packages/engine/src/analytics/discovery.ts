import type { ColumnStore } from '../columns/columnStore.js';
import type { SpellTable } from '../spells/spellTable.js';

// Removal discovery. Finds removals the curated table CANNOT explain (`!canRemove`) — the candidates
// that should enrich the table (or be sent to the backend). TWO signals, mirroring removal.cleanse:
//
//  (1) DISPEL — every active removal fires SPELL_DISPEL with (remover spellId, removed via extraSpellId),
//      so the log is the authoritative source of remover capabilities: we observe removers, not
//      enumerate them. Novel when `table.canRemove(remover, removed)` is false.
//
//  (2) IMMUNITY-CLEAR — an immunity buff (Blessing-of-Freedom-style) strips a snare/root with NO
//      SPELL_DISPEL, logging only a plain SPELL_AURA_REMOVED on the debuff. To discover a NEW such
//      remover we correlate, CONSERVATIVELY: a player-cast BUFF applied to a player within
//      IMMUNITY_DISCOVERY_TOLERANCE_MS of a KNOWN-removable dangerous debuff's removal on that player,
//      where no dispel explains the removal and the buff doesn't already cover it. Anchoring on
//      known-removable debuffs + a tight window + a tie cap keeps coincidences (a proc that happens to
//      land as a debuff expires) low; like all discoveries it's review-gated (backend promotes only
//      after ≥2 distinct runs). Already-curated immunity removers (BoF) are `canRemove`=true ⇒ NOT
//      re-discovered, so this surfaces only the genuinely new ones.

// Buff-application ⇆ debuff-removal correlation window. The real signal shares a millisecond; the slack
// absorbs log jitter while staying tight enough that unrelated coincidences are rare.
const IMMUNITY_DISCOVERY_TOLERANCE_MS = 60;
// If more than this many DISTINCT buffs land at the same closest instant as the removal, attribution is
// ambiguous (a busy millisecond) and we skip rather than guess.
const IMMUNITY_DISCOVERY_MAX_TIES = 2;
// The CRUCIAL noise filter: only consider a removable debuff that was CUT SHORT — removed at least this
// long before its natural duration would have expired. Without it, every natural expiry that happens to
// coincide with a proc/buff (Fireblood, Sudden Doom, …) mints a bogus remover. A removal needs a known
// duration AND a matched application to be judged; unjudgeable removals are skipped (conservative).
const IMMUNITY_DISCOVERY_EARLY_MARGIN_MS = 750;

export type DiscoveryReason =
  | 'unknown-remover' // the removing spell isn't a curated remover
  | 'unknown-debuff' // the removed aura has no known removal categories
  | 'capability-gap'; // both are known, but provides ∩ removableBy is empty (a tag is missing)

export interface RemovalDiscovery {
  removerSpellId: number;
  removerName: string;
  removedSpellId: number;
  removedName: string;
  reason: DiscoveryReason;
  occurrences: number;
  firstMs: number;
  lastMs: number;
  /** A player observed performing the removal (display name). */
  sampleSource: string;
  /** How the removal was observed (default 'dispel'). Immunity-clear discoveries warrant extra review. */
  via?: 'dispel' | 'immunity';
}

/** First index `i` with `arr[i] >= x` (lower bound) in an ascending array. */
function lowerBound(arr: number[], x: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid]! < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function discoverRemovals(store: ColumnStore, table: SpellTable): RemovalDiscovery[] {
  const dispelId = store.eventTypeId('SPELL_DISPEL');
  const removedId = store.eventTypeId('SPELL_AURA_REMOVED');
  const appliedId = store.eventTypeId('SPELL_AURA_APPLIED');

  const byKey = new Map<string, RemovalDiscovery>();
  const bump = (
    remover: number,
    removerName: string,
    removed: number,
    removedName: string,
    reason: DiscoveryReason,
    via: RemovalDiscovery['via'],
    ms: number,
    sampleSource: string,
  ): void => {
    const key = `${remover}:${removed}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.occurrences++;
      existing.lastMs = ms;
    } else {
      byKey.set(key, {
        removerSpellId: remover,
        removerName,
        removedSpellId: removed,
        removedName,
        reason,
        occurrences: 1,
        firstMs: ms,
        lastMs: ms,
        sampleSource,
        via,
      });
    }
  };

  // ---- Pass 1: DISPEL discovery + indices for the immunity-clear correlation ----
  // dispels naming a debuff on a player (to know which removals are already explained by a dispel)
  const dispelsByPlayer = new Map<number, { ms: number; removed: number }[]>();
  // known-removable dangerous-debuff removals (the anchor: a removable thing came off)
  const removableRemovals: { player: number; spell: number; ms: number }[] = [];
  const removalTimesByPlayer = new Map<number, number[]>(); // ms-sorted (store order)

  for (let i = 0; i < store.count; i++) {
    const et = store.eventType[i]!;
    if (et === dispelId) {
      if (store.detail(i, 'auraType') !== 'DEBUFF') continue; // cleanses only, not offensive buff-purges
      const unit = store.targetGuid[i]!;
      const removed = store.detailNumber(i, 'extraSpellId');
      if (removed !== undefined && store.isPlayer(unit)) {
        (dispelsByPlayer.get(unit) ?? dispelsByPlayer.set(unit, []).get(unit)!).push({ ms: store.ts[i]!, removed });
      }
      const src = store.sourceGuid[i]!;
      if (!store.isPlayer(src)) continue; // a player performed the removal
      const remover = store.spellIdNum(i);
      if (remover === null || removed === undefined) continue;
      if (table.canRemove(remover, removed)) continue; // already explained by the table

      const reason: DiscoveryReason = !table.isRemover(remover)
        ? 'unknown-remover'
        : table.removableCategoriesOf(removed).length === 0
          ? 'unknown-debuff'
          : 'capability-gap';
      const removedName =
        (typeof store.detail(i, 'extraSpellName') === 'string' ? (store.detail(i, 'extraSpellName') as string) : '') ||
        store.spellName(removed) ||
        `spell:${removed}`;
      bump(remover, store.spellName(remover) || `spell:${remover}`, removed, removedName, reason, 'dispel', store.ts[i]!, store.actorName(src) || `#${src}`);
    } else if (et === removedId) {
      const unit = store.targetGuid[i]!;
      if (!store.isPlayer(unit)) continue;
      if (store.detail(i, 'auraType') !== 'DEBUFF') continue;
      const spell = store.spellId[i]!;
      if (table.removableCategoriesOf(spell).length === 0) continue; // anchor: a KNOWN removable debuff
      const ms = store.ts[i]!;
      removableRemovals.push({ player: unit, spell, ms });
      (removalTimesByPlayer.get(unit) ?? removalTimesByPlayer.set(unit, []).get(unit)!).push(ms);
    }
  }

  // ---- Pass 2: player BUFF applications NEAR a removal + removable-debuff APPLICATIONS (for early-check)
  // (Bounding to near-removal buffs keeps memory small on a multi-million-event log.)
  const buffAppsByPlayer = new Map<number, { ms: number; spell: number; src: number }[]>();
  const debuffAppliedByKey = new Map<string, number[]>(); // `${player}:${spell}` → ms-sorted apply times
  if (appliedId !== undefined && removableRemovals.length > 0) {
    for (let i = 0; i < store.count; i++) {
      if (store.eventType[i] !== appliedId) continue;
      const auraType = store.detail(i, 'auraType');
      const dst = store.targetGuid[i]!;
      if (auraType === 'DEBUFF') {
        if (!store.isPlayer(dst)) continue;
        const spell = store.spellId[i]!;
        if (table.removableCategoriesOf(spell).length === 0) continue;
        const key = `${dst}:${spell}`;
        (debuffAppliedByKey.get(key) ?? debuffAppliedByKey.set(key, []).get(key)!).push(store.ts[i]!);
      } else if (auraType === 'BUFF') {
        const times = removalTimesByPlayer.get(dst);
        if (!times) continue; // this player never had a removable debuff come off
        const src = store.sourceGuid[i]!;
        if (!store.isPlayer(src)) continue; // player-cast buff only (excludes mob/boss auras)
        const ms = store.ts[i]!;
        const idx = lowerBound(times, ms - IMMUNITY_DISCOVERY_TOLERANCE_MS);
        if (idx >= times.length || times[idx]! > ms + IMMUNITY_DISCOVERY_TOLERANCE_MS) continue; // not near a removal
        (buffAppsByPlayer.get(dst) ?? buffAppsByPlayer.set(dst, []).get(dst)!).push({ ms, spell: store.spellId[i]!, src });
      }
    }
  }

  // Was this removal a CUT-SHORT (real removal) rather than a natural expiry? Needs a known duration and
  // a matched prior application; otherwise unjudgeable ⇒ treated as not-early (skipped).
  const isEarlyRemoval = (player: number, spell: number, removeMs: number): boolean => {
    const durMs = (table.get(spell)?.durationSeconds ?? 0) * 1000;
    if (durMs <= 0) return false;
    const applies = debuffAppliedByKey.get(`${player}:${spell}`);
    if (!applies) return false;
    // latest application at or before the removal
    const idx = lowerBound(applies, removeMs + 1) - 1;
    if (idx < 0) return false;
    return removeMs - applies[idx]! <= durMs - IMMUNITY_DISCOVERY_EARLY_MARGIN_MS;
  };

  // ---- Correlate: a CUT-SHORT removable removal + a coincident, novel buff ⇒ immunity candidate ----
  for (const rem of removableRemovals) {
    // Skip if an active dispel already accounts for this removal (don't double-count active removers).
    const dps = dispelsByPlayer.get(rem.player);
    if (dps?.some((d) => d.removed === rem.spell && Math.abs(d.ms - rem.ms) <= IMMUNITY_DISCOVERY_TOLERANCE_MS)) continue;

    // Skip natural expiries — the dominant false positive (a proc that lands as the debuff times out).
    if (!isEarlyRemoval(rem.player, rem.spell, rem.ms)) continue;

    const buffs = buffAppsByPlayer.get(rem.player);
    if (!buffs) continue;

    let minDelta = Infinity;
    const within: { spell: number; src: number; delta: number }[] = [];
    for (const b of buffs) {
      const delta = Math.abs(b.ms - rem.ms);
      if (delta <= IMMUNITY_DISCOVERY_TOLERANCE_MS) {
        within.push({ spell: b.spell, src: b.src, delta });
        if (delta < minDelta) minDelta = delta;
      }
    }
    if (within.length === 0) continue;

    // If a coincident KNOWN remover already explains this clear (e.g. curated BoF cleared Chains), the
    // removal is NOT novel — skip it entirely, so an unrelated buff that merely co-occurred with the real
    // clear isn't blamed. This is the symmetric guard to removal.cleanse's immunity-credit path.
    if (within.some((w) => table.canRemove(w.spell, rem.spell))) continue;

    const closest = within.filter((w) => w.delta === minDelta);
    const distinct = new Set(closest.map((w) => w.spell));
    if (distinct.size > IMMUNITY_DISCOVERY_MAX_TIES) continue; // ambiguous (busy ms) — don't guess

    for (const w of closest) {
      if (w.spell === rem.spell) continue; // a buff isn't its own removal target
      // The debuff is known-removable (anchor), so it's never an unknown-debuff here.
      const reason: DiscoveryReason = table.isRemover(w.spell) ? 'capability-gap' : 'unknown-remover';
      const removedName = table.get(rem.spell)?.name ?? store.spellName(rem.spell) ?? `spell:${rem.spell}`;
      bump(w.spell, store.spellName(w.spell) || `spell:${w.spell}`, rem.spell, removedName, reason, 'immunity', rem.ms, store.actorName(w.src) || `#${w.src}`);
    }
  }

  return [...byKey.values()].sort((a, b) => b.occurrences - a.occurrences);
}
