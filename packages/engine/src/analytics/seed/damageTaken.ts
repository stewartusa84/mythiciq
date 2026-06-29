import { DAMAGE_EVENT_NAMES } from '../../columns/schema.js';
import type { Analytic } from '../types.js';
import { bump, effectiveRange, rankByName } from './helpers.js';

export interface DamageTakenResult {
  totalTaken: number;
  byActor: { id: number; name: string; value: number }[];
  // TODO(avoidable-split): needs a per-encounter ability-classification table.
  avoidable: number | null;
  unavoidable: number | null;
}

/** Damage taken, per actor (summed by TARGET). */
export const damageTaken: Analytic<DamageTakenResult> = {
  id: 'damageTaken',
  title: 'Damage Taken',
  role: 'all',
  columns: ['eventType', 'target', 'amount'],
  summary: true,
  run(ctx) {
    const { start, end } = effectiveRange(ctx);
    const { store } = ctx;
    const { eventType, targetGuid, amount } = store;
    const damageIds = store.eventTypeIds(DAMAGE_EVENT_NAMES);
    const byActor = new Map<number, number>();
    let total = 0;

    for (let i = start; i < end; i++) {
      if (!damageIds.has(eventType[i]!)) continue;
      const amt = amount[i]!;
      total += amt;
      bump(byActor, targetGuid[i]!, amt);
    }

    return {
      totalTaken: total,
      byActor: rankByName(byActor, (id) => store.actorName(id) || `#${id}`),
      avoidable: null,
      unavoidable: null,
    };
  },
};
