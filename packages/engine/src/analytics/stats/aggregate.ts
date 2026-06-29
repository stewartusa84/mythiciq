// Shared statistics helper. Two hard rules from the spec:
//  1. Every statistic is reported ALONGSIDE its sample count (no count-less numbers).
//  2. Censored (death-ended) episodes are reported as a separate population — never
//     silently folded into or dropped from the completed-episode stats.

export interface AggregateStats {
  count: number;
  /** null when count === 0 */
  mean: number | null;
  /** keyed "p50", "p95", …; value null when count === 0 */
  percentiles: Record<string, number | null>;
}

/**
 * Mean + nearest-rank percentiles over `values`. Nearest-rank: for percentile p the
 * value at 1-based rank ceil(p/100 · N). Always returns `count`.
 */
export function aggregate(values: readonly number[], pcts: readonly number[] = [50, 95]): AggregateStats {
  const count = values.length;
  const percentiles: Record<string, number | null> = {};

  if (count === 0) {
    for (const p of pcts) percentiles[`p${p}`] = null;
    return { count: 0, mean: null, percentiles };
  }

  const sorted = [...values].sort((a, b) => a - b);
  let sum = 0;
  for (const v of values) sum += v;

  for (const p of pcts) {
    const rank = Math.min(Math.max(Math.ceil((p / 100) * count), 1), count);
    percentiles[`p${p}`] = sorted[rank - 1]!;
  }
  return { count, mean: sum / count, percentiles };
}

export interface CensoredStats {
  /** stats over episodes that completed normally (reached the success condition) */
  completed: AggregateStats;
  /** episodes that ended in death before completing — reported, never dropped */
  censoredByDeath: number;
}

export function summarizeCensored(
  completedValues: readonly number[],
  censoredByDeath: number,
  pcts: readonly number[] = [50, 95],
): CensoredStats {
  return { completed: aggregate(completedValues, pcts), censoredByDeath };
}

/**
 * Human-readable line that surfaces BOTH populations, e.g.:
 *   "Recovery: 12 episodes, p50 1.8s, p95 4.1s; 3 additional ended in death."
 * `unit` scales/labels the numbers (e.g. divide ms→s with unit='s', divisor=1000).
 */
export function formatCensored(
  label: string,
  stats: CensoredStats,
  opts: { unit?: string; divisor?: number; primaryPct?: number; secondaryPct?: number } = {},
): string {
  const { unit = '', divisor = 1, primaryPct = 50, secondaryPct = 95 } = opts;
  const { completed, censoredByDeath } = stats;
  const fmt = (v: number | null) => (v === null ? 'n/a' : `${(v / divisor).toFixed(1)}${unit}`);
  const primary = completed.percentiles[`p${primaryPct}`] ?? null;
  const secondary = completed.percentiles[`p${secondaryPct}`] ?? null;

  let s = `${label}: ${completed.count} episode${completed.count === 1 ? '' : 's'}`;
  if (completed.count > 0) {
    s += `, p${primaryPct} ${fmt(primary)}, p${secondaryPct} ${fmt(secondary)}`;
  }
  if (censoredByDeath > 0) {
    s += `; ${censoredByDeath} additional ended in death`;
  }
  return s + '.';
}
