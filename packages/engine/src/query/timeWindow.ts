// Time-window queries over the sorted `ts` column. Because events are appended in
// log order, `ts` is sorted ascending, so a window is two binary searches — O(log n)
// to locate, then O(window) to iterate. Never a full scan.

/** First index `i` with `ts[i] >= value` (lower bound). */
export function lowerBound(ts: Float64Array, value: number): number {
  let lo = 0;
  let hi = ts.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (ts[mid]! < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** First index `i` with `ts[i] > value` (upper bound). */
export function upperBound(ts: Float64Array, value: number): number {
  let lo = 0;
  let hi = ts.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (ts[mid]! <= value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export interface IndexRange {
  /** inclusive */
  start: number;
  /** exclusive */
  end: number;
}

/**
 * Half-open index range `[start, end)` for events with `startMs <= ts < endMs`.
 * Use this to scope analytics or event scrubbing to a pull without copying.
 */
export function windowRange(ts: Float64Array, startMs: number, endMs: number): IndexRange {
  return { start: lowerBound(ts, startMs), end: lowerBound(ts, endMs) };
}
