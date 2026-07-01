import { DAMAGE_EVENT_NAMES } from '../../columns/schema.js';
import type { Analytic } from '../types.js';
import { SpellTable } from '../../spells/spellTable.js';
import { effectiveRange, rankByName } from './helpers.js';

export interface EnemyDamageSpell {
  id: number;
  name: string;
  value: number;
}

/** How an enemy's damage splits by whether the party could have prevented it — damage from an
 *  interruptible cast (a kick would have stopped it) vs. from a dispellable debuff (a dispel would
 *  have removed it) vs. everything else. Classification is bounded by curated spell-table coverage. */
export interface EnemyDamageSplit {
  /** Damage from spells the table flags as coming from an interruptible cast. */
  interruptible: number;
  /** Damage from spells the table flags as a dispellable debuff. */
  dispellable: number;
  /** Everything else (unavoidable / uncurated). */
  other: number;
}

/** One enemy (grouped by npc TYPE, so every instance of the same mob combines) and the damage it
 *  dealt to players in the range. */
export interface EnemyDamageRow {
  /** Stable grouping key: `npc:<id>` for creatures, `unit:<guidId>` otherwise. */
  key: string;
  /** Parsed creature npcId (null for unresolved sources). */
  npcId: number | null;
  name: string;
  total: number;
  /** Distinct source GUIDs of this npc type that dealt damage (how many of them there were). */
  instances: number;
  /** Number of damaging hits landed. */
  hits: number;
  /** interruptible-cast / dispellable-debuff / other split of `total`. */
  split: EnemyDamageSplit;
  /** Which abilities dealt the damage (busiest first). */
  bySpell: EnemyDamageSpell[];
  /** Which players took the damage (busiest first). */
  byTarget: { id: number; name: string; value: number }[];
}

export interface DamageTakenByEnemyResult {
  totalTaken: number;
  /** Run-wide split of `totalTaken` (interruptible-cast / dispellable-debuff / other). */
  split: EnemyDamageSplit;
  byEnemy: EnemyDamageRow[];
  coverageNote: string;
}

interface Accum {
  key: string;
  npcId: number | null;
  nameId: number; // interned actor-name id for label resolution (0 => use fallback)
  fallback: string;
  total: number;
  hits: number;
  interruptible: number;
  dispellable: number;
  instances: Set<number>;
  bySpell: Map<number, number>;
  byTarget: Map<number, number>;
}

/** True for a nil/environment source GUID (all zeros) — reflected/self/environmental damage with no
 *  real enemy behind it (e.g. Shadow Word: Death's reflect). Filtered out of the enemy breakdown. */
function isNilGuid(s: string): boolean {
  if (s === '') return true;
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) !== 48 /* '0' */) return false;
  return true;
}

/**
 * Damage TAKEN by players, grouped by the ENEMY that dealt it — so a raid/dungeon can see at a glance
 * which mob type is the biggest threat (useful when several adds are up and it's hard to tell which is
 * doing the most). Enemies are grouped by npc TYPE (parsed from the `Creature-…-<npcId>-<spawn>` GUID),
 * so every instance of the same add combines into one row; bosses are their own row. Environmental /
 * unresolved sources collapse into an "Environment" bucket. Only damage landing on a PLAYER is counted
 * (source is any non-player unit). Per enemy we also break out the abilities used + which players ate it.
 */
export function computeDamageTakenByEnemy(
  store: Parameters<Analytic['run']>[0]['store'],
  table: SpellTable,
  range: { start: number; end: number },
): DamageTakenByEnemyResult {
  const damageIds = store.eventTypeIds(DAMAGE_EVENT_NAMES);
  const { eventType, sourceGuid, sourceName, targetGuid, spellId, amount } = store;

  // Memoized npcId per source GUID id (string parse once per distinct guid).
  const npcCache = new Map<number, number | null>();
  const npcOf = (guidId: number): number | null => {
    let v = npcCache.get(guidId);
    if (v === undefined) {
      const s = store.str(guidId);
      let n: number | null = null;
      if (s.startsWith('Creature-') || s.startsWith('Vehicle-')) {
        const p = s.split('-');
        if (p.length >= 6) {
          const x = Number(p[5]);
          if (Number.isFinite(x)) n = x;
        }
      }
      npcCache.set(guidId, (v = n));
    }
    return v;
  };

  const groups = new Map<string, Accum>();
  let total = 0;
  let totalInterruptible = 0;
  let totalDispellable = 0;
  // Memoized per-spell classification: 0 = other, 1 = interruptible cast, 2 = dispellable debuff.
  const classCache = new Map<number, 0 | 1 | 2>();
  const classify = (sp: number): 0 | 1 | 2 => {
    let c = classCache.get(sp);
    if (c === undefined) {
      c = table.interruptPriority(sp) !== null ? 1 : table.dispelPriority(sp) !== null ? 2 : 0;
      classCache.set(sp, c);
    }
    return c;
  };

  for (let i = range.start; i < range.end; i++) {
    if (!damageIds.has(eventType[i]!)) continue;
    const target = targetGuid[i]!;
    // Only damage taken BY players (mob-on-mob / friendly damage is out of scope).
    if (!store.isPlayer(target)) continue;
    const source = sourceGuid[i]!;
    if (store.isPlayer(source)) continue; // exclude the rare player↔player (friendly-fire) case

    const srcStr = source === 0 ? '' : store.str(source);
    // Drop nil-GUID sources — reflected/self/environmental damage with no real enemy behind it.
    if (isNilGuid(srcStr)) continue;

    const npc = npcOf(source);
    const key = npc !== null ? `npc:${npc}` : `unit:${source}`;
    const fallback = npc !== null ? `NPC ${npc}` : srcStr;

    let g = groups.get(key);
    if (!g) {
      g = {
        key,
        npcId: npc,
        nameId: sourceName[i]!,
        fallback,
        total: 0,
        hits: 0,
        interruptible: 0,
        dispellable: 0,
        instances: new Set<number>(),
        bySpell: new Map<number, number>(),
        byTarget: new Map<number, number>(),
      };
      groups.set(key, g);
    }
    const amt = amount[i]!;
    const sp = spellId[i]!;
    const cls = classify(sp);
    total += amt;
    g.total += amt;
    g.hits++;
    if (cls === 1) { g.interruptible += amt; totalInterruptible += amt; }
    else if (cls === 2) { g.dispellable += amt; totalDispellable += amt; }
    g.instances.add(source);
    if (g.nameId === 0 && sourceName[i]! !== 0) g.nameId = sourceName[i]!;
    g.bySpell.set(sp, (g.bySpell.get(sp) ?? 0) + amt);
    g.byTarget.set(target, (g.byTarget.get(target) ?? 0) + amt);
  }

  const byEnemy: EnemyDamageRow[] = [...groups.values()]
    .map((g) => ({
      key: g.key,
      npcId: g.npcId,
      name: (g.nameId !== 0 ? store.str(g.nameId) : '') || g.fallback,
      total: g.total,
      instances: g.instances.size,
      hits: g.hits,
      split: {
        interruptible: g.interruptible,
        dispellable: g.dispellable,
        other: g.total - g.interruptible - g.dispellable,
      },
      bySpell: rankByName(g.bySpell, (id) => store.spellName(id) || (id <= 0 ? 'Melee' : `spell:${id}`), 8),
      byTarget: rankByName(g.byTarget, (id) => store.actorName(id) || `#${id}`, 8),
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 40);

  return {
    totalTaken: total,
    split: {
      interruptible: totalInterruptible,
      dispellable: totalDispellable,
      other: total - totalInterruptible - totalDispellable,
    },
    byEnemy,
    coverageNote:
      'Damage taken by players, grouped by enemy npc type (every instance of the same mob combined). Reflected/environmental (nil-source) damage is excluded. Interruptible/dispellable split is bounded by curated spell-table coverage.',
  };
}

export const damageTakenByEnemy: Analytic<DamageTakenByEnemyResult> = {
  id: 'damageTaken.byEnemy',
  title: 'Damage Taken by Enemy',
  role: 'all',
  columns: ['eventType', 'source', 'target', 'spell', 'amount'],
  summary: false,
  run(ctx) {
    return computeDamageTakenByEnemy(ctx.store, ctx.spellTable ?? SpellTable.empty(), effectiveRange(ctx));
  },
};
