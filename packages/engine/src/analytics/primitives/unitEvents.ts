import type { ColumnStore } from '../../columns/columnStore.js';

export type HealType = 'direct' | 'hot';

export interface UnitHeal {
  ms: number;
  eventIndex: number;
  /** effective heal = amount − overheal (raw amount minus overhealing) */
  effective: number;
  type: HealType;
}

/**
 * Per-unit auxiliary index: effective heals received and death timestamps. Built once
 * per store (memoized in Primitives) so heal-response / recovery / dispel analytics
 * don't each re-scan the whole log. Lists are in ascending ms (events are log-ordered).
 */
export class UnitEventIndex {
  readonly healsByUnit = new Map<number, UnitHeal[]>();
  readonly deathsByUnit = new Map<number, number[]>();

  static build(store: ColumnStore): UnitEventIndex {
    const idx = new UnitEventIndex();
    const directId = store.eventTypeId('SPELL_HEAL');
    const hotId = store.eventTypeId('SPELL_PERIODIC_HEAL');
    const diedId = store.eventTypeId('UNIT_DIED');

    for (let i = 0; i < store.count; i++) {
      const et = store.eventType[i]!;
      if (et === directId || et === hotId) {
        const unit = store.targetGuid[i]!;
        if (unit === 0) continue;
        const amount = store.amount[i]!;
        const overheal = store.detailNumber(i, 'overheal') ?? store.detailNumber(i, 'overhealing') ?? 0;
        const list = idx.healsByUnit.get(unit) ?? idx.healsByUnit.set(unit, []).get(unit)!;
        list.push({
          ms: store.ts[i]!,
          eventIndex: i,
          effective: amount - overheal,
          type: et === hotId ? 'hot' : 'direct',
        });
      } else if (et === diedId) {
        const unit = store.targetGuid[i]!;
        if (unit === 0) continue;
        const list = idx.deathsByUnit.get(unit) ?? idx.deathsByUnit.set(unit, []).get(unit)!;
        list.push(store.ts[i]!);
      }
    }
    return idx;
  }

  /** First effective heal on `unitId` strictly after `ms` meeting the effective floor. */
  firstHealAfter(unitId: number, ms: number, minEffective: number): UnitHeal | undefined {
    const list = this.healsByUnit.get(unitId);
    if (!list) return undefined;
    for (const h of list) {
      if (h.ms <= ms) continue;
      if (h.effective >= minEffective) return h;
    }
    return undefined;
  }

  /** First death of `unitId` strictly after `ms`. */
  firstDeathAfter(unitId: number, ms: number): number | undefined {
    const list = this.deathsByUnit.get(unitId);
    if (!list) return undefined;
    for (const d of list) if (d > ms) return d;
    return undefined;
  }
}
