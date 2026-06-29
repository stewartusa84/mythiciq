import type { Analytic, AnalyticContext } from '../types.js';
import { Primitives } from '../primitives/index.js';
import { SpellTable } from '../../spells/spellTable.js';
import { msRangeOf } from './helpers.js';

/** Melee-swing event types (landed). SWING_MISSED is a different event type and is
 *  therefore excluded from both variants by construction. */
const MELEE_SWING_NAMES = ['SWING_DAMAGE', 'SWING_DAMAGE_LANDED'] as const;

export interface TankMeleeParams {
  /** "big hit" = swing ≥ this fraction of the unit's max HP at impact */
  bigHitFrac: number;
}
export const DEFAULT_TANK_MELEE_PARAMS: TankMeleeParams = { bigHitFrac: 0.3 };

export interface CountDamage {
  count: number;
  damage: number;
  /** count as a percentage of the unit's total melee swings (0–100) */
  pctOfSwings: number;
}

export interface TankMeleeUnit {
  unitId: number;
  name: string;
  isTank: boolean;
  swings: number;
  totalDamage: number;
  /** (a) literal: blocked==0 && absorbed==0 */
  literalUnmitigated: CountDamage;
  /** (b) active-mitigation-down: landed while no active-mitigation buff was up.
   *  null when no active-mitigation buff ids are curated in the table (honest, not 0). */
  amDownUnmitigated: CountDamage | null;
  /** swings ≥ bigHitFrac × maxHp at impact (maxHp from the HP timeline) */
  bigHits: CountDamage;
  /** swings whose max HP at impact was unknown (couldn't be sized for big-hit) */
  unsizedSwings: number;
}

export interface TankMeleeResult {
  params: TankMeleeParams;
  tankUnitId: number | null;
  tankName: string;
  perUnit: TankMeleeUnit[];
  /** false ⇒ variant (b) is unavailable because the table has no active-mitigation ids */
  activeMitigationConfigured: boolean;
}

/** [start, end) intervals during which `unit` had ≥1 active-mitigation buff up. */
function activeMitigationIntervals(
  store: AnalyticContext['store'],
  amIds: ReadonlySet<number>,
): Map<number, [number, number][]> {
  const out = new Map<number, [number, number][]>();
  if (amIds.size === 0) return out;
  const applied = store.eventTypeId('SPELL_AURA_APPLIED');
  const refresh = store.eventTypeId('SPELL_AURA_REFRESH');
  const removed = store.eventTypeId('SPELL_AURA_REMOVED');
  const open = new Map<string, number>(); // `${unit}:${spell}` -> startMs

  for (let i = 0; i < store.count; i++) {
    const et = store.eventType[i]!;
    const isApply = et === applied || et === refresh;
    const isRemove = et === removed;
    if (!isApply && !isRemove) continue;
    const sid = store.spellId[i]!;
    if (!amIds.has(sid)) continue;
    const unit = store.targetGuid[i]!;
    if (unit === 0) continue;
    const key = `${unit}:${sid}`;
    if (isApply) {
      if (!open.has(key)) open.set(key, store.ts[i]!);
    } else {
      const start = open.get(key);
      if (start !== undefined) {
        open.delete(key);
        (out.get(unit) ?? out.set(unit, []).get(unit)!).push([start, store.ts[i]!]);
      }
    }
  }
  // Buffs still up at log end stay up to +Infinity.
  for (const [key, start] of open) {
    const unit = Number(key.slice(0, key.indexOf(':')));
    (out.get(unit) ?? out.set(unit, []).get(unit)!).push([start, Infinity]);
  }
  // Merge overlapping intervals per unit so "any buff up" is a single union.
  for (const [unit, ivs] of out) {
    ivs.sort((a, b) => a[0] - b[0]);
    const merged: [number, number][] = [];
    for (const iv of ivs) {
      const last = merged[merged.length - 1];
      if (last && iv[0] <= last[1]) last[1] = Math.max(last[1], iv[1]);
      else merged.push([iv[0], iv[1]]);
    }
    out.set(unit, merged);
  }
  return out;
}

function inAnyInterval(ivs: [number, number][] | undefined, t: number): boolean {
  if (!ivs) return false;
  // linear is fine; per-unit AM interval lists are short
  for (const [s, e] of ivs) if (t >= s && t < e) return true;
  return false;
}

export function computeTankMelee(
  store: AnalyticContext['store'],
  prim: Primitives,
  table: SpellTable,
  params: TankMeleeParams,
  range: { startMs: number; endMs: number },
): TankMeleeResult {
  const swingIds = store.eventTypeIds(MELEE_SWING_NAMES);
  const amIds = table.activeMitigationSpellIds();
  const amConfigured = amIds.size > 0;
  const amIntervals = activeMitigationIntervals(store, amIds);
  const hp = prim.hpTimeline();

  const units = new Map<number, TankMeleeUnit>();
  const get = (unitId: number): TankMeleeUnit =>
    units.get(unitId) ??
    units
      .set(unitId, {
        unitId,
        name: store.actorName(unitId) || store.str(unitId),
        isTank: false,
        swings: 0,
        totalDamage: 0,
        literalUnmitigated: { count: 0, damage: 0, pctOfSwings: 0 },
        amDownUnmitigated: amConfigured ? { count: 0, damage: 0, pctOfSwings: 0 } : null,
        bigHits: { count: 0, damage: 0, pctOfSwings: 0 },
        unsizedSwings: 0,
      })
      .get(unitId)!;

  for (let i = 0; i < store.count; i++) {
    if (!swingIds.has(store.eventType[i]!)) continue;
    const unit = store.targetGuid[i]!;
    if (unit === 0 || !store.isPlayer(unit)) continue;
    const ms = store.ts[i]!;
    if (ms < range.startMs || ms >= range.endMs) continue;

    const u = get(unit);
    const dmg = store.amount[i]!;
    u.swings++;
    u.totalDamage += dmg;

    const blocked = store.detailNumber(i, 'blocked') ?? 0;
    const absorbed = store.detailNumber(i, 'absorbed') ?? 0;
    if (blocked === 0 && absorbed === 0) {
      u.literalUnmitigated.count++;
      u.literalUnmitigated.damage += dmg;
    }
    if (amConfigured && u.amDownUnmitigated) {
      if (!inAnyInterval(amIntervals.get(unit), ms)) {
        u.amDownUnmitigated.count++;
        u.amDownUnmitigated.damage += dmg;
      }
    }
    const maxHp = hp.hpAt(unit, ms)?.maxHp;
    if (maxHp === undefined || maxHp <= 0) {
      u.unsizedSwings++;
    } else if (dmg >= params.bigHitFrac * maxHp) {
      u.bigHits.count++;
      u.bigHits.damage += dmg;
    }
  }

  // Each bucket's share of the unit's total melee swings (how much of the melee stream
  // landed unmitigated / with mitigation down / as a big hit).
  for (const u of units.values()) {
    const denom = u.swings || 1;
    u.literalUnmitigated.pctOfSwings = (u.literalUnmitigated.count / denom) * 100;
    if (u.amDownUnmitigated) u.amDownUnmitigated.pctOfSwings = (u.amDownUnmitigated.count / denom) * 100;
    u.bigHits.pctOfSwings = (u.bigHits.count / denom) * 100;
  }

  // Tank = the player who ate the most melee swings.
  const perUnit = [...units.values()].sort((a, b) => b.swings - a.swings);
  let tankUnitId: number | null = null;
  let tankName = '';
  if (perUnit.length > 0 && perUnit[0]!.swings > 0) {
    perUnit[0]!.isTank = true;
    tankUnitId = perUnit[0]!.unitId;
    tankName = perUnit[0]!.name;
  }

  return { params, tankUnitId, tankName, perUnit, activeMitigationConfigured: amConfigured };
}

export const tankMelee: Analytic<TankMeleeResult> = {
  id: 'tank.unmitigatedMelee',
  title: 'Unmitigated Melee (tank)',
  role: 'tank',
  columns: ['eventType', 'target', 'spell', 'amount', 'side', 'ts'],
  summary: false,
  run(ctx) {
    return computeTankMelee(
      ctx.store,
      Primitives.for(ctx.store),
      ctx.spellTable ?? SpellTable.empty(),
      DEFAULT_TANK_MELEE_PARAMS,
      msRangeOf(ctx),
    );
  },
};
