import type { Analytic, AnalyticContext } from '../types.js';
import { Primitives } from '../primitives/index.js';
import { msRangeOf } from './helpers.js';
import { summarizeCensored, type CensoredStats } from '../stats/aggregate.js';

export interface RecoveryParams {
  /** cross BELOW this fraction starts a DAMAGED episode */
  damagedFrac: number;
  /** reach this fraction to end the episode as recovered */
  healthyFrac: number;
  percentiles: number[];
}

export const DEFAULT_RECOVERY_PARAMS: RecoveryParams = {
  damagedFrac: 0.4,
  healthyFrac: 0.9,
  percentiles: [50, 95],
};

export interface RecoveryEpisode {
  unitId: number;
  name: string;
  startMs: number;
  endMs: number;
  durationMs: number;
}

export interface RecoveryResult {
  params: RecoveryParams;
  episodes: RecoveryEpisode[];
  durationsMs: number[];
  censoredByDeath: number;
  stats: CensoredStats;
}

type Step = { ms: number; death: boolean; frac: number };

/**
 * Recovery-time via a hysteresis state machine with two thresholds. HEALTHY → DAMAGED on
 * crossing below `damagedFrac`; DAMAGED → HEALTHY on reaching `healthyFrac` (success).
 * Further dips while DAMAGED do NOT start new episodes. An episode that ends in death
 * before recovering is censored and bucketed separately (never dropped).
 */
export function computeRecovery(
  store: AnalyticContext['store'],
  prim: Primitives,
  params: RecoveryParams,
  range: { startMs: number; endMs: number },
): RecoveryResult {
  const hp = prim.hpTimeline();
  const idx = prim.unitEvents();
  const episodes: RecoveryEpisode[] = [];
  let censoredByDeath = 0;

  const inRange = (ms: number) => ms >= range.startMs && ms < range.endMs;

  for (const t of hp.byUnit.values()) {
    if (!store.isPlayer(t.unitId)) continue;

    // Merge HP samples with this unit's deaths; at equal ms, samples sort before deaths
    // (a killing-blow snapshot is observed, then the death censors the episode).
    const steps: Step[] = t.samples.map((s) => ({
      ms: s.ms,
      death: false,
      frac: s.maxHp > 0 ? s.currentHp / s.maxHp : 1,
    }));
    for (const d of idx.deathsByUnit.get(t.unitId) ?? []) {
      steps.push({ ms: d, death: true, frac: 0 });
    }
    steps.sort((a, b) => a.ms - b.ms || (a.death ? 1 : 0) - (b.death ? 1 : 0));

    let damaged = false;
    let episodeStart = 0;
    let prevFrac: number | undefined;

    for (const step of steps) {
      if (step.death) {
        if (damaged) {
          if (inRange(episodeStart)) censoredByDeath++;
          damaged = false;
          prevFrac = undefined;
        }
        continue;
      }
      if (!damaged) {
        if (prevFrac !== undefined && prevFrac >= params.damagedFrac && step.frac < params.damagedFrac) {
          damaged = true;
          episodeStart = step.ms;
        }
      } else if (step.frac >= params.healthyFrac) {
        if (inRange(episodeStart)) {
          episodes.push({
            unitId: t.unitId,
            name: t.name,
            startMs: episodeStart,
            endMs: step.ms,
            durationMs: step.ms - episodeStart,
          });
        }
        damaged = false;
      }
      prevFrac = step.frac;
    }
  }

  const durationsMs = episodes.map((e) => e.durationMs);
  return {
    params,
    episodes,
    durationsMs,
    censoredByDeath,
    stats: summarizeCensored(durationsMs, censoredByDeath, params.percentiles),
  };
}

export const recovery: Analytic<RecoveryResult> = {
  id: 'healer.recovery',
  title: 'Recovery Time',
  role: 'healer',
  columns: ['eventType', 'target', 'side', 'ts'],
  summary: false,
  run(ctx) {
    return computeRecovery(ctx.store, Primitives.for(ctx.store), DEFAULT_RECOVERY_PARAMS, msRangeOf(ctx));
  },
};
