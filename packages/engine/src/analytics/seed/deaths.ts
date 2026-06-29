import type { ColumnStore } from '../../columns/columnStore.js';
import { DAMAGE_EVENT_NAMES } from '../../columns/schema.js';
import type { Analytic } from '../types.js';
import { effectiveRange } from './helpers.js';

/**
 * Seconds added to the M+ timer per player death — but ONLY when a death-penalty affix
 * is slotted. Base M+ deaths cost no timer in this season; the penalty exists solely as
 * an affix mechanic.
 */
export const DEATH_PENALTY_SECONDS = 15;

/**
 * Affixes that make each player death cost timer. Currently just Xal'atath's Guile (147),
 * the +12-and-above affix that adds +15s per death. Read from CHALLENGE_MODE_START's
 * `affixes` array. Add ids here if future affixes carry a death penalty.
 */
export const DEATH_PENALTY_AFFIX_IDS: ReadonlySet<number> = new Set([147]);

export interface DeathRow {
  actorId: number;
  name: string;
  tsMs: number;
  /** killing-blow spell id, if the death was preceded by identifiable damage */
  lastHitSpellId?: number;
}

export interface DeathsResult {
  deaths: DeathRow[];
  count: number;
  /** Affixes for this run (from CHALLENGE_MODE_START); empty if the log has no key start. */
  affixes: number[];
  /** True when a death-penalty affix (e.g. Xal'atath's Guile) is present. */
  deathPenaltyActive: boolean;
  /** Seconds each death adds to the timer (0 unless a death-penalty affix is slotted). */
  perDeathPenaltySeconds: number;
  /** Total seconds added to the M+ timer (count * perDeathPenaltySeconds). */
  timerPenaltySeconds: number;
}

/**
 * Affixes for the run, read from the first CHALLENGE_MODE_START anywhere in the store.
 * Scanned across the whole log (not the segment range) because a per-pull segment won't
 * contain the key-start event.
 */
function runAffixes(store: ColumnStore): number[] {
  const cmStart = store.eventTypeId('CHALLENGE_MODE_START');
  if (cmStart === undefined) return [];
  const { eventType, count } = store;
  for (let i = 0; i < count; i++) {
    if (eventType[i] !== cmStart) continue;
    const a = store.detail(i, 'affixes');
    return Array.isArray(a) ? a : [];
  }
  return [];
}

/**
 * Deaths with the M+ timer penalty. Walks UNIT_DIED rows and attributes the most
 * recent damage event on that target as the killing blow (best-effort).
 */
export const deaths: Analytic<DeathsResult> = {
  id: 'deaths',
  title: 'Deaths',
  role: 'all',
  columns: ['eventType', 'target', 'spell', 'ts'],
  summary: true,
  run(ctx) {
    const { start, end } = effectiveRange(ctx);
    const { store } = ctx;
    const { eventType, targetGuid, ts } = store;
    const unitDied = store.eventTypeId('UNIT_DIED');
    const damageIds = store.eventTypeIds(DAMAGE_EVENT_NAMES);
    const rows: DeathRow[] = [];
    const affixes = runAffixes(store);
    const deathPenaltyActive = affixes.some((a) => DEATH_PENALTY_AFFIX_IDS.has(a));
    const perDeathPenaltySeconds = deathPenaltyActive ? DEATH_PENALTY_SECONDS : 0;
    if (unitDied === undefined) {
      return {
        deaths: rows,
        count: 0,
        affixes,
        deathPenaltyActive,
        perDeathPenaltySeconds,
        timerPenaltySeconds: 0,
      };
    }

    for (let i = start; i < end; i++) {
      if (eventType[i] !== unitDied) continue;
      const actorId = targetGuid[i]!;
      // UNIT_DIED fires for every unit that dies OR despawns — enemy mobs, pets, and
      // summoned guardians (Chi-Ji, totems, War Banner) all emit it. Only player deaths
      // carry the M+ timer penalty, so scope to Player- GUIDs.
      if (!store.isPlayer(actorId)) continue;
      let lastHitSpellId: number | undefined;
      for (let j = i - 1; j >= start && j >= i - 64; j--) {
        if (targetGuid[j] === actorId && damageIds.has(eventType[j]!)) {
          const sid = store.spellIdNum(j);
          if (sid !== null) lastHitSpellId = sid;
          break;
        }
      }
      rows.push({
        actorId,
        name: store.actorName(actorId),
        tsMs: ts[i]!,
        ...(lastHitSpellId !== undefined ? { lastHitSpellId } : {}),
      });
    }

    return {
      deaths: rows,
      count: rows.length,
      affixes,
      deathPenaltyActive,
      perDeathPenaltySeconds,
      timerPenaltySeconds: rows.length * perDeathPenaltySeconds,
    };
  },
};
