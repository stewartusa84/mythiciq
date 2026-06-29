import type { ColumnStore } from '../../columns/columnStore.js';
import { FormatId, DAMAGE_EVENT_NAMES, HEAL_EVENT_NAMES } from '../../columns/schema.js';

/**
 * Derived per-unit HP timeline — the primitive everything else (heal-response,
 * recovery, unmitigated-hit "big hit" sizing, …) depends on. Reconstructed from the
 * advanced-block snapshots (`infoGuid` + `currentHp`/`maxHp`) carried on damage/heal
 * events.
 *
 * Design rules (per spec):
 *  - `maxHp` is recorded PER SAMPLE — never assumed constant (cooldowns/auras change
 *    effective max HP mid-fight).
 *  - HP is raw current HP. TODO(v2): absorb-adjusted *effective* health (raw HP plus
 *    the active damage-absorb shield) is a future refinement; the advanced block's
 *    `absorb` field is available for it but is intentionally NOT folded in yet.
 *  - Per-unit sample DENSITY (samples/sec over the observed window) is recorded so
 *    consumers can judge how trustworthy a reconstruction is before relying on it.
 *  - Between samples, HP is reconstructed as hold-last (step function): the value of
 *    the most recent snapshot at or before the query time.
 */
export interface HpSample {
  ms: number;
  currentHp: number;
  maxHp: number;
}

export interface UnitHpTimeline {
  unitId: number;
  name: string;
  /** sorted ascending by ms (snapshots arrive in log/time order) */
  samples: HpSample[];
  /** samples per second over [firstMs, lastMs]; 0 if a single sample / zero span */
  sampleDensity: number;
  firstMs: number;
  lastMs: number;
}

export interface HpQuery {
  currentHp: number;
  maxHp: number;
  fraction: number;
}

export class HpTimeline {
  readonly byUnit: Map<number, UnitHpTimeline>;

  constructor(byUnit: Map<number, UnitHpTimeline>) {
    this.byUnit = byUnit;
  }

  unit(unitId: number): UnitHpTimeline | undefined {
    return this.byUnit.get(unitId);
  }

  /**
   * Reconstructed HP for `unitId` at time `ms` (hold-last). Returns undefined when the
   * unit is unknown or `ms` precedes its first snapshot (HP genuinely unknown then).
   */
  hpAt(unitId: number, ms: number): HpQuery | undefined {
    const t = this.byUnit.get(unitId);
    if (!t || t.samples.length === 0) return undefined;
    const s = t.samples;
    if (ms < s[0]!.ms) return undefined;
    // last index with samples[idx].ms <= ms
    let lo = 0;
    let hi = s.length; // first index with ms > query
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (s[mid]!.ms <= ms) lo = mid + 1;
      else hi = mid;
    }
    const sample = s[lo - 1]!;
    return {
      currentHp: sample.currentHp,
      maxHp: sample.maxHp,
      fraction: sample.maxHp > 0 ? sample.currentHp / sample.maxHp : 0,
    };
  }
}

/** Half-open event-index range [start, end) — used to scope a timeline to a single run. */
export interface IdxRange {
  start: number;
  end: number;
}

export function buildHpTimeline(store: ColumnStore, range?: IdxRange): HpTimeline {
  const hpEventIds = store.eventTypeIds([...DAMAGE_EVENT_NAMES, ...HEAL_EVENT_NAMES]);
  const samplesByUnit = new Map<number, HpSample[]>();

  const lo = range?.start ?? 0;
  const hi = range?.end ?? store.count;
  for (let i = lo; i < hi; i++) {
    if (store.formatId[i] !== FormatId.ADVANCED) continue;
    if (!hpEventIds.has(store.eventType[i]!)) continue;
    const snap = store.advancedSnapshot(i);
    if (!snap) continue;
    let arr = samplesByUnit.get(snap.unitId);
    if (!arr) {
      arr = [];
      samplesByUnit.set(snap.unitId, arr);
    }
    arr.push({ ms: store.ts[i]!, currentHp: snap.currentHp, maxHp: snap.maxHp });
  }

  const byUnit = new Map<number, UnitHpTimeline>();
  for (const [unitId, samples] of samplesByUnit) {
    const firstMs = samples[0]!.ms;
    const lastMs = samples[samples.length - 1]!.ms;
    const spanSec = (lastMs - firstMs) / 1000;
    byUnit.set(unitId, {
      unitId,
      name: store.actorName(unitId) || store.str(unitId),
      samples,
      sampleDensity: spanSec > 0 ? samples.length / spanSec : 0,
      firstMs,
      lastMs,
    });
  }
  return new HpTimeline(byUnit);
}
