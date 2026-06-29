import type { Analytic, AnalyticContext } from '../types.js';
import { SpellTable } from '../../spells/spellTable.js';
import { msRangeOf, bump, rankByName } from './helpers.js';
import { aggregate, type AggregateStats } from '../stats/aggregate.js';

const COVERAGE_NOTE =
  'Priority split is bounded by curated spell-table coverage; spells absent from the table fall into "unknown".';

// ---------------------------------------------------------------------------
// Interrupts: successful SPELL_INTERRUPT split by interrupt priority, plus a
// success RATE derived from interruptible enemy casts that COMPLETED (a completed
// interruptible cast = a missed interrupt opportunity; an interrupted cast emits no
// SPELL_CAST_SUCCESS).
// ---------------------------------------------------------------------------
export interface InterruptPriorityResult {
  total: number;
  bySource: { id: number; name: string; value: number }[];
  /** Per-player count of successful interrupts on DANGEROUS (high-priority) enemy casts. */
  bySourceDangerous: { id: number; name: string; value: number }[];
  byPriority: Record<'dangerous' | 'regular' | 'unknown', { success: number; missed: number }>;
  successRateByPriority: Record<'dangerous' | 'regular' | 'unknown', number | null>;
  coverageNote: string;
}

export function computeInterruptsPriority(
  store: AnalyticContext['store'],
  table: SpellTable,
  range: { startMs: number; endMs: number },
): InterruptPriorityResult {
  const interruptId = store.eventTypeId('SPELL_INTERRUPT');
  const castId = store.eventTypeId('SPELL_CAST_SUCCESS');
  const byPriority = {
    dangerous: { success: 0, missed: 0 },
    regular: { success: 0, missed: 0 },
    unknown: { success: 0, missed: 0 },
  };
  const bySource = new Map<number, number>();
  const bySourceDangerous = new Map<number, number>();
  let total = 0;

  for (let i = 0; i < store.count; i++) {
    const et = store.eventType[i]!;
    const ms = store.ts[i]!;
    if (ms < range.startMs || ms >= range.endMs) continue;

    if (et === interruptId) {
      const extra = store.detailNumber(i, 'extraSpellId');
      const prio = extra !== undefined ? store_interruptBucket(table, extra) : 'unknown';
      byPriority[prio].success++;
      total++;
      bump(bySource, store.sourceGuid[i]!, 1);
      if (prio === 'dangerous') bump(bySourceDangerous, store.sourceGuid[i]!, 1);
    } else if (et === castId) {
      const src = store.sourceGuid[i]!;
      if (src === 0 || store.isPlayer(src)) continue; // enemy casts only
      const info = table.get(store.spellId[i]!);
      if (!info?.interruptible) continue; // a completed interruptible cast == missed interrupt
      const prio = (info.interruptPriority ?? 'regular') as 'dangerous' | 'regular';
      byPriority[prio].missed++;
    }
  }

  const rate = (b: { success: number; missed: number }) =>
    b.success + b.missed > 0 ? b.success / (b.success + b.missed) : null;

  return {
    total,
    bySource: rankByName(bySource, (id) => store.actorName(id) || `#${id}`),
    bySourceDangerous: rankByName(bySourceDangerous, (id) => store.actorName(id) || `#${id}`),
    byPriority,
    successRateByPriority: {
      dangerous: rate(byPriority.dangerous),
      regular: rate(byPriority.regular),
      unknown: rate(byPriority.unknown),
    },
    coverageNote: COVERAGE_NOTE,
  };
}

function store_interruptBucket(table: SpellTable, spellId: number): 'dangerous' | 'regular' | 'unknown' {
  return table.interruptPriority(spellId) ?? 'unknown';
}

export const interruptsPriority: Analytic<InterruptPriorityResult> = {
  id: 'interrupts.priority',
  title: 'Interrupts by Priority',
  role: 'all',
  columns: ['eventType', 'source', 'spell', 'side', 'ts'],
  summary: false,
  run(ctx) {
    return computeInterruptsPriority(ctx.store, ctx.spellTable ?? SpellTable.empty(), msRangeOf(ctx));
  },
};

// ---------------------------------------------------------------------------
// Dispels: enemy-applied dispellable DEBUFF on a player (falling edge) -> next
// SPELL_DISPEL action on that player removing it. Latency + success/miss split by
// dispel priority. Miss = the debuff was removed (expired) or still up before a dispel.
// ---------------------------------------------------------------------------
export interface DispelPriorityBucket {
  success: number;
  miss: number;
  latency: AggregateStats;
}
export interface DispelPriorityResult {
  byPriority: Record<'dangerous' | 'regular', DispelPriorityBucket>;
  /** Per-player count of successful dispels of DANGEROUS (high-priority) debuffs. */
  bySourceDangerous: { id: number; name: string; value: number }[];
  coverageNote: string;
}

export function computeDispelsPriority(
  store: AnalyticContext['store'],
  table: SpellTable,
  range: { startMs: number; endMs: number },
  pcts: number[] = [50, 95],
): DispelPriorityResult {
  const appliedId = store.eventTypeId('SPELL_AURA_APPLIED');
  const removedId = store.eventTypeId('SPELL_AURA_REMOVED');
  const dispelId = store.eventTypeId('SPELL_DISPEL');

  // indexes (whole log; episodes filtered to range by apply time)
  const dispelsByPlayer = new Map<number, { ms: number; extra: number; src: number }[]>();
  const removedByKey = new Map<string, number[]>();
  for (let i = 0; i < store.count; i++) {
    const et = store.eventType[i]!;
    if (et === dispelId) {
      const unit = store.targetGuid[i]!;
      if (!store.isPlayer(unit)) continue;
      const extra = store.detailNumber(i, 'extraSpellId') ?? 0;
      (dispelsByPlayer.get(unit) ?? dispelsByPlayer.set(unit, []).get(unit)!).push({ ms: store.ts[i]!, extra, src: store.sourceGuid[i]! });
    } else if (et === removedId) {
      const unit = store.targetGuid[i]!;
      if (!store.isPlayer(unit)) continue;
      const key = `${unit}:${store.spellId[i]!}`;
      (removedByKey.get(key) ?? removedByKey.set(key, []).get(key)!).push(store.ts[i]!);
    }
  }

  const buckets = {
    dangerous: { success: 0, miss: 0, latencies: [] as number[] },
    regular: { success: 0, miss: 0, latencies: [] as number[] },
  };
  const bySourceDangerous = new Map<number, number>();

  for (let i = 0; i < store.count; i++) {
    if (store.eventType[i] !== appliedId) continue;
    const src = store.sourceGuid[i]!;
    if (src === 0 || store.isPlayer(src)) continue; // enemy-applied only
    const unit = store.targetGuid[i]!;
    if (!store.isPlayer(unit)) continue;
    if (store.detail(i, 'auraType') !== 'DEBUFF') continue;
    const spell = store.spellId[i]!;
    const prio = table.dispelPriority(spell);
    if (prio === null) continue; // only debuffs known-dispellable in the table
    const applyMs = store.ts[i]!;
    if (applyMs < range.startMs || applyMs >= range.endMs) continue;

    const dispels = dispelsByPlayer.get(unit);
    const nextDispel = dispels?.find((d) => d.ms > applyMs && d.extra === spell);
    const removals = removedByKey.get(`${unit}:${spell}`);
    const nextRemoved = removals?.find((r) => r > applyMs);

    const b = buckets[prio];
    if (nextDispel && (nextRemoved === undefined || nextDispel.ms <= nextRemoved)) {
      b.success++;
      b.latencies.push(nextDispel.ms - applyMs);
      if (prio === 'dangerous') bump(bySourceDangerous, nextDispel.src, 1);
    } else {
      b.miss++;
    }
  }

  return {
    byPriority: {
      dangerous: { success: buckets.dangerous.success, miss: buckets.dangerous.miss, latency: aggregate(buckets.dangerous.latencies, pcts) },
      regular: { success: buckets.regular.success, miss: buckets.regular.miss, latency: aggregate(buckets.regular.latencies, pcts) },
    },
    bySourceDangerous: rankByName(bySourceDangerous, (id) => store.actorName(id) || `#${id}`),
    coverageNote: COVERAGE_NOTE,
  };
}

export const dispelsPriority: Analytic<DispelPriorityResult> = {
  id: 'dispels.priority',
  title: 'Dispels by Priority',
  role: 'healer',
  columns: ['eventType', 'source', 'target', 'spell', 'side', 'ts'],
  summary: false,
  run(ctx) {
    return computeDispelsPriority(ctx.store, ctx.spellTable ?? SpellTable.empty(), msRangeOf(ctx));
  },
};
