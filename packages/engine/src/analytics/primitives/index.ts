import type { ColumnStore } from '../../columns/columnStore.js';
import { buildHpTimeline, HpTimeline } from './hpTimeline.js';
import { UnitEventIndex } from './unitEvents.js';
import { ReplayModel } from './replayModel.js';

/**
 * Lazily-computed, memoized derived primitives for a parsed store. Analytics declare a
 * dependency on these (via `Primitives.for(store)`) instead of re-deriving them, so the
 * expensive reconstructions happen once per log and are shared across every analytic and
 * every per-segment run.
 */
export class Primitives {
  private constructor(private readonly store: ColumnStore) {}

  private _hp?: HpTimeline;
  private _unitEvents?: UnitEventIndex;
  private _replay?: ReplayModel;

  hpTimeline(): HpTimeline {
    return (this._hp ??= buildHpTimeline(this.store));
  }

  unitEvents(): UnitEventIndex {
    return (this._unitEvents ??= UnitEventIndex.build(this.store));
  }

  /** Per-unit aura/cast/HP timelines for the replay viewer (seekable by time T). */
  replayModel(): ReplayModel {
    return (this._replay ??= ReplayModel.build(this.store));
  }

  private static cache = new WeakMap<ColumnStore, Primitives>();
  static for(store: ColumnStore): Primitives {
    let p = Primitives.cache.get(store);
    if (!p) {
      p = new Primitives(store);
      Primitives.cache.set(store, p);
    }
    return p;
  }
}

export { HpTimeline, type HpSample, type UnitHpTimeline, type HpQuery } from './hpTimeline.js';
export { UnitEventIndex, type UnitHeal, type HealType } from './unitEvents.js';
export {
  ReplayModel,
  ReplayView,
  toReplayData,
  type AuraInterval,
  type CastInterval,
  type ActiveAura,
  type UnitReplayState,
  type AuraKind,
  type CastResult,
  type ReplayModelData,
  type ReplayUnit,
  type ReplayDeath,
  type ReplayBookmark,
  type BookmarkKind,
  type JournalEvent,
  type JournalEventKind,
  type RunTimeline,
  type MeterRow,
  type AvoidableHit,
  type EncounterSpan,
  type InterruptEvent,
  type DamageTick,
  type HealTick,
  type CombatAggregate,
  type CombatPop,
  type CooldownState,
  type CooldownStatus,
} from './replayModel.js';
