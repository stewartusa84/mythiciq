import type { AnalyticContext } from '../types.js';

/** Resolve the [start, end) event range an analytic should operate over. */
export function effectiveRange(ctx: AnalyticContext): { start: number; end: number } {
  return ctx.range ?? { start: 0, end: ctx.store.count };
}

/**
 * Resolve the [startMs, endMs) wall-clock window for the analytic's range. Episode-based
 * analytics (heal-response, recovery) operate on derived timelines, not the event
 * columns directly, so they scope by time rather than event index.
 */
export function msRangeOf(ctx: AnalyticContext): { startMs: number; endMs: number } {
  if (!ctx.range) return { startMs: -Infinity, endMs: Infinity };
  const { start, end } = ctx.range;
  const { ts, count } = ctx.store;
  return {
    startMs: start < count ? ts[start]! : Infinity,
    endMs: end < count ? ts[end]! : Infinity,
  };
}

/** Duration in seconds spanned by an event range (guards against zero). */
export function rangeSeconds(ctx: AnalyticContext): number {
  const { start, end } = effectiveRange(ctx);
  const { ts } = ctx.store;
  if (end <= start) return 0;
  const ms = ts[end - 1]! - ts[start]!;
  return ms > 0 ? ms / 1000 : 0;
}

/** Accumulate a numeric value into a Map keyed by id. */
export function bump(map: Map<number, number>, key: number, value: number): void {
  map.set(key, (map.get(key) ?? 0) + value);
}

/** Convert an id->number map to a sorted (desc) array of named rows. */
export function rankByName(
  map: Map<number, number>,
  nameOf: (id: number) => string,
  limit = 50,
): { id: number; name: string; value: number }[] {
  return [...map.entries()]
    .map(([id, value]) => ({ id, name: nameOf(id), value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}
