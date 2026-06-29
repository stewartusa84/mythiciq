import type { Analytic, AnalyticContext } from '../types.js';
import { Primitives, type HealType } from '../primitives/index.js';
import { msRangeOf } from './helpers.js';
import { aggregate, type AggregateStats } from '../stats/aggregate.js';

export interface HealResponseParams {
  /** HP fraction whose downward crossing triggers an episode */
  thresholdFrac: number;
  /** minimum effective heal (amount − overheal) that counts as a response */
  minEffectiveHeal: number;
  percentiles: number[];
}

export const DEFAULT_HEAL_RESPONSE_PARAMS: HealResponseParams = {
  thresholdFrac: 0.5,
  minEffectiveHeal: 1,
  percentiles: [50, 95],
};

export interface HealResponseEpisode {
  unitId: number;
  name: string;
  crossingMs: number;
  latencyMs: number;
  respType: HealType;
}

export interface HealResponseResult {
  params: HealResponseParams;
  episodes: HealResponseEpisode[];
  latenciesMs: number[];
  stats: AggregateStats;
  byType: { direct: number; hot: number };
  /** crossed low, then DIED before a qualifying heal — bucketed, never dropped */
  diedWhileLow: number;
  /** crossed low, but no qualifying heal and no death before the window ended */
  unresolved: number;
}

/**
 * Heal-response latency. Falling-edge detection on each player's HP-fraction timeline:
 * an episode triggers only on the transition from ≥threshold to <threshold (not on every
 * below-threshold sample). From the crossing we find the next effective heal
 * (amount − overheal ≥ minEffectiveHeal) on that unit and record the latency, tagging
 * the responder as direct cast vs HoT tick.
 *
 * Survivorship-bias guard: if the unit DIES while low before a qualifying heal lands,
 * that episode is bucketed as `diedWhileLow` — it is NOT dropped (dropping the hardest
 * cases would flatter the latency distribution).
 */
export function computeHealResponse(
  store: AnalyticContext['store'],
  prim: Primitives,
  params: HealResponseParams,
  range: { startMs: number; endMs: number },
): HealResponseResult {
  const hp = prim.hpTimeline();
  const idx = prim.unitEvents();
  const episodes: HealResponseEpisode[] = [];
  let diedWhileLow = 0;
  let unresolved = 0;

  for (const t of hp.byUnit.values()) {
    if (!store.isPlayer(t.unitId)) continue;
    const s = t.samples;
    for (let k = 1; k < s.length; k++) {
      const prev = s[k - 1]!;
      const cur = s[k]!;
      const fPrev = prev.maxHp > 0 ? prev.currentHp / prev.maxHp : 1;
      const fCur = cur.maxHp > 0 ? cur.currentHp / cur.maxHp : 1;
      if (!(fPrev >= params.thresholdFrac && fCur < params.thresholdFrac)) continue; // falling edge only

      const crossingMs = cur.ms;
      if (crossingMs < range.startMs || crossingMs >= range.endMs) continue;

      const heal = idx.firstHealAfter(t.unitId, crossingMs, params.minEffectiveHeal);
      const death = idx.firstDeathAfter(t.unitId, crossingMs);

      if (death !== undefined && (heal === undefined || death <= heal.ms)) {
        diedWhileLow++;
      } else if (heal !== undefined) {
        episodes.push({
          unitId: t.unitId,
          name: t.name,
          crossingMs,
          latencyMs: heal.ms - crossingMs,
          respType: heal.type,
        });
      } else {
        unresolved++;
      }
    }
  }

  const latenciesMs = episodes.map((e) => e.latencyMs);
  const byType = { direct: 0, hot: 0 };
  for (const e of episodes) byType[e.respType]++;

  return {
    params,
    episodes,
    latenciesMs,
    stats: aggregate(latenciesMs, params.percentiles),
    byType,
    diedWhileLow,
    unresolved,
  };
}

export const healResponse: Analytic<HealResponseResult> = {
  id: 'healer.healResponse',
  title: 'Heal-Response Latency',
  role: 'healer',
  columns: ['eventType', 'target', 'amount', 'side', 'ts'],
  summary: false,
  run(ctx) {
    return computeHealResponse(
      ctx.store,
      Primitives.for(ctx.store),
      DEFAULT_HEAL_RESPONSE_PARAMS,
      msRangeOf(ctx),
    );
  },
};
