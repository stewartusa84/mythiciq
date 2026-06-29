import type { Analytic } from '../types.js';
import { Primitives } from '../primitives/index.js';

export interface HpTimelineUnitSummary {
  unitId: number;
  name: string;
  samples: number;
  sampleDensity: number;
  minFraction: number;
}

export interface HpTimelineResult {
  /** per-player HP-timeline coverage, so consumers can judge reliability */
  players: HpTimelineUnitSummary[];
  totalUnitsTracked: number;
  note: string;
}

/**
 * Registry face of the HP-timeline primitive: a compact per-player coverage summary
 * (sample count + density + lowest observed HP fraction). The full per-unit samples are
 * the shared primitive (`Primitives.for(store).hpTimeline()`) that the latency/recovery
 * analytics consume.
 */
export const hpTimeline: Analytic<HpTimelineResult> = {
  id: 'hp.timeline',
  title: 'HP Timeline Coverage',
  role: 'all',
  columns: ['eventType', 'amount', 'side', 'ts'],
  summary: false,
  run(ctx) {
    const hp = Primitives.for(ctx.store).hpTimeline();
    const players: HpTimelineUnitSummary[] = [];
    for (const t of hp.byUnit.values()) {
      if (!ctx.store.isPlayer(t.unitId)) continue;
      let minFraction = 1;
      for (const s of t.samples) {
        const f = s.maxHp > 0 ? s.currentHp / s.maxHp : 1;
        if (f < minFraction) minFraction = f;
      }
      players.push({
        unitId: t.unitId,
        name: t.name,
        samples: t.samples.length,
        sampleDensity: t.sampleDensity,
        minFraction,
      });
    }
    players.sort((a, b) => b.samples - a.samples);
    return {
      players,
      totalUnitsTracked: hp.byUnit.size,
      note: 'Raw current HP from advanced snapshots; maxHp is per-sample. Absorb-adjusted effective health is a v2 refinement (TODO).',
    };
  },
};
