import type { ColumnStore } from '../columns/columnStore.js';
import type { ColumnId } from '../columns/schema.js';
import type { Segment } from '../segments/segmenter.js';
import type { SpellTable } from '../spells/spellTable.js';

export type Role = 'all' | 'tank' | 'healer' | 'dps';

/**
 * Context handed to every analytic. An analytic reads the columnar store directly
 * (zero-copy) and may scope itself to a single segment via `range`.
 */
export interface AnalyticContext {
  store: ColumnStore;
  segments: Segment[];
  /**
   * Optional event-index window `[start, end)` the analytic should restrict to.
   * When omitted, the analytic runs over the whole log. Per-pull runs pass the
   * segment's range (located by binary search on the ts column).
   */
  range?: { start: number; end: number };
  /**
   * The curated spell table (#7). Analytics that need avoidable/priority/active-mitigation
   * data read it here; when absent they fall back to an empty table and report accordingly.
   */
  spellTable?: SpellTable;
}

/**
 * A pluggable metric. Each analytic is a self-contained module that DECLARES the
 * columns it reads (`columns`) so the engine can validate/schedule without the
 * analytic touching the parser. Add new metrics by registering more of these — the
 * parser never changes.
 */
export interface Analytic<T = unknown> {
  /** Stable unique id, e.g. "deaths", "dps.overall". */
  id: string;
  /** Human-readable title for UI. */
  title: string;
  /** Role this metric is primarily for (UI grouping / filtering). */
  role: Role;
  /** Columns this analytic depends on (documentation + future validation). */
  columns: ColumnId[];
  /**
   * True if this metric belongs in the fast "summary first" report. False metrics
   * can be computed lazily/in the background while the user reviews the summary.
   */
  summary?: boolean;
  /** Compute the metric. Should be a pure function of the context. */
  run(ctx: AnalyticContext): T;
}

export type AnalyticResult = {
  id: string;
  title: string;
  role: Role;
  value: unknown;
};
