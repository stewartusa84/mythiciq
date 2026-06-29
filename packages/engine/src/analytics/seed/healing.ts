import { HEAL_EVENT_NAMES } from '../../columns/schema.js';
import type { Analytic } from '../types.js';
import { bump, effectiveRange, rangeSeconds, rankByName } from './helpers.js';

export interface HealingResult {
  totalHealing: number;
  durationSeconds: number;
  raidHps: number;
  bySource: { id: number; name: string; value: number; hps: number }[];
  /**
   * Overheal% IS available now: advanced heals carry `overheal` in the side table.
   * Aggregated lazily here would require a side-table scan; left for the deep view.
   */
  overhealPctAvailable: boolean;
}

/** HPS meter: total healing and per-source HPS over the range. */
export const healingDone: Analytic<HealingResult> = {
  id: 'hps.overall',
  title: 'Healing Done',
  role: 'healer',
  columns: ['eventType', 'source', 'amount', 'ts'],
  summary: true,
  run(ctx) {
    const { start, end } = effectiveRange(ctx);
    const { store } = ctx;
    const { eventType, sourceGuid, amount } = store;
    const healIds = store.eventTypeIds(HEAL_EVENT_NAMES);
    const seconds = rangeSeconds(ctx);
    const bySrc = new Map<number, number>();
    let total = 0;

    for (let i = start; i < end; i++) {
      if (!healIds.has(eventType[i]!)) continue;
      const amt = amount[i]!;
      total += amt;
      bump(bySrc, store.ownerOf(sourceGuid[i]!), amt); // attribute pet healing to its owner
    }

    const rows = rankByName(bySrc, (id) => store.actorName(id) || `#${id}`).map((r) => ({
      ...r,
      hps: seconds > 0 ? r.value / seconds : 0,
    }));

    return {
      totalHealing: total,
      durationSeconds: seconds,
      raidHps: seconds > 0 ? total / seconds : 0,
      bySource: rows,
      overhealPctAvailable: true,
    };
  },
};

// TODO(externals): external defensive CDs need a spell-id allowlist keyed by role.
export const externalCooldowns: Analytic<{ todo: string }> = {
  id: 'healer.externals',
  title: 'External Cooldowns',
  role: 'healer',
  columns: ['eventType', 'source', 'target', 'spell'],
  summary: false,
  run: () => ({ todo: 'needs external-CD spell-id allowlist' }),
};
