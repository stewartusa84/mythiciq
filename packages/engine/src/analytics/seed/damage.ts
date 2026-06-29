import { DAMAGE_EVENT_NAMES } from '../../columns/schema.js';
import type { Analytic } from '../types.js';
import { bump, effectiveRange, rangeSeconds, rankByName } from './helpers.js';

export interface DamageMeterRow {
  id: number;
  name: string;
  value: number;
  dps: number;
}

export interface DamageResult {
  totalDamage: number;
  durationSeconds: number;
  raidDps: number;
  bySource: DamageMeterRow[];
}

/** DPS meter: total damage and per-source DPS over the range. */
export const damageDone: Analytic<DamageResult> = {
  id: 'dps.overall',
  title: 'Damage Done',
  role: 'dps',
  columns: ['eventType', 'source', 'amount', 'ts'],
  summary: true,
  run(ctx) {
    const { start, end } = effectiveRange(ctx);
    const { store } = ctx;
    const { eventType, sourceGuid, amount } = store;
    const damageIds = store.eventTypeIds(DAMAGE_EVENT_NAMES);
    const seconds = rangeSeconds(ctx);
    const bySrc = new Map<number, number>();
    let total = 0;

    for (let i = start; i < end; i++) {
      if (!damageIds.has(eventType[i]!)) continue;
      const amt = amount[i]!;
      total += amt;
      bump(bySrc, store.ownerOf(sourceGuid[i]!), amt); // attribute pet damage to its owner
    }

    const rows = rankByName(bySrc, (id) => store.actorName(id) || `#${id}`).map((r) => ({
      ...r,
      dps: seconds > 0 ? r.value / seconds : 0,
    }));

    return {
      totalDamage: total,
      durationSeconds: seconds,
      raidDps: seconds > 0 ? total / seconds : 0,
      bySource: rows,
    };
  },
};

export interface BreakdownResult {
  byTarget: { id: number; name: string; value: number }[];
  bySpell: { id: number; name: string; value: number }[];
}

/** DPS damage breakdown by target and by spell (DPS deep-dive). */
export const damageBreakdown: Analytic<BreakdownResult> = {
  id: 'dps.breakdown',
  title: 'Damage Breakdown (target / spell)',
  role: 'dps',
  columns: ['eventType', 'target', 'spell', 'amount'],
  summary: false,
  run(ctx) {
    const { start, end } = effectiveRange(ctx);
    const { store } = ctx;
    const { eventType, targetGuid, spellId, amount } = store;
    const damageIds = store.eventTypeIds(DAMAGE_EVENT_NAMES);
    const byTarget = new Map<number, number>();
    const bySpell = new Map<number, number>();

    for (let i = start; i < end; i++) {
      if (!damageIds.has(eventType[i]!)) continue;
      const amt = amount[i]!;
      bump(byTarget, targetGuid[i]!, amt);
      bump(bySpell, spellId[i]!, amt);
    }

    return {
      byTarget: rankByName(byTarget, (id) => store.actorName(id) || `#${id}`),
      bySpell: rankByName(bySpell, (id) => store.spellName(id) || (id <= 0 ? 'Melee' : `spell:${id}`)),
    };
  },
};

// TODO(priority-target): needs an encounter-specific target allowlist.
export const priorityTargetDamage: Analytic<{ todo: string }> = {
  id: 'dps.priorityTarget',
  title: 'Priority-Target Damage',
  role: 'dps',
  columns: ['eventType', 'target', 'amount'],
  summary: false,
  run: () => ({ todo: 'needs encounter-specific priority-target allowlist' }),
};
