import type { Analytic } from '../types.js';
import { bump, effectiveRange, rankByName } from './helpers.js';

export interface InterruptsResult {
  total: number;
  bySource: { id: number; name: string; value: number }[];
  // TODO(success-rate): needs SPELL_CAST_START / SPELL_INTERRUPT correlation.
  successRateAvailable: false;
}

/** Interrupt tracking: count successful interrupts per source. */
export const interrupts: Analytic<InterruptsResult> = {
  id: 'interrupts',
  title: 'Interrupts',
  role: 'all',
  columns: ['eventType', 'source'],
  summary: true,
  run(ctx) {
    const { start, end } = effectiveRange(ctx);
    const { store } = ctx;
    const { eventType, sourceGuid } = store;
    const interruptId = store.eventTypeId('SPELL_INTERRUPT');
    const bySrc = new Map<number, number>();
    let total = 0;
    if (interruptId !== undefined) {
      for (let i = start; i < end; i++) {
        if (eventType[i] !== interruptId) continue;
        total++;
        bump(bySrc, sourceGuid[i]!, 1);
      }
    }

    return {
      total,
      bySource: rankByName(bySrc, (id) => store.actorName(id) || `#${id}`),
      successRateAvailable: false,
    };
  },
};

/** Dispels: count successful dispels per source. */
export const dispels: Analytic<{ total: number; bySource: { id: number; name: string; value: number }[] }> = {
  id: 'dispels',
  title: 'Dispels',
  role: 'healer',
  columns: ['eventType', 'source'],
  summary: true,
  run(ctx) {
    const { start, end } = effectiveRange(ctx);
    const { store } = ctx;
    const { eventType, sourceGuid } = store;
    const dispelId = store.eventTypeId('SPELL_DISPEL');
    const bySrc = new Map<number, number>();
    let total = 0;
    if (dispelId !== undefined) {
      for (let i = start; i < end; i++) {
        if (eventType[i] !== dispelId) continue;
        total++;
        bump(bySrc, sourceGuid[i]!, 1);
      }
    }
    return { total, bySource: rankByName(bySrc, (id) => store.actorName(id) || `#${id}`) };
  },
};
