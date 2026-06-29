import { ColumnStore } from './columns/columnStore.js';
import { instantiateParser, type ParserWasmExports } from './wasm/loader.js';
import { segment, type Segment, type SegmentOptions } from './segments/segmenter.js';
import { AnalyticsRegistry } from './analytics/registry.js';
import { seedAnalytics } from './analytics/seed/index.js';
import type { AnalyticResult } from './analytics/types.js';
import type { SpellTable } from './spells/spellTable.js';

/** A registry pre-loaded with the seed analytics. */
export function createRegistry(): AnalyticsRegistry {
  return new AnalyticsRegistry().registerAll(seedAnalytics);
}

export interface ParsedLog {
  wasm: ParserWasmExports;
  store: ColumnStore;
  segments: Segment[];
}

export interface ParseOptions {
  segment?: SegmentOptions;
}

/** Instantiate the WASM module and parse a log in one call (tests / one-shot use). */
export async function parseLog(
  wasmBytes: BufferSource,
  logBytes: Uint8Array,
  opts?: ParseOptions,
): Promise<ParsedLog> {
  const wasm = await instantiateParser(wasmBytes);
  return parseWith(wasm, logBytes, opts);
}

/**
 * Parse `logBytes` with an already-instantiated module. The log bytes are copied once
 * into WASM linear memory; everything after that is columnar and zero-copy.
 */
export function parseWith(
  wasm: ParserWasmExports,
  logBytes: Uint8Array,
  opts?: ParseOptions,
): ParsedLog {
  wasm.reset();
  const len = logBytes.byteLength;
  const ptr = wasm.alloc(len);
  // Copy the raw log into wasm memory (the one unavoidable copy: host bytes -> wasm).
  new Uint8Array(wasm.memory.buffer, ptr, len).set(logBytes);
  wasm.parse(ptr, len);

  // Build zero-copy views AFTER parse (memory has finished growing).
  const store = new ColumnStore(wasm);
  // The columns are independent of the input buffer, so free it now.
  wasm.dealloc(ptr, len);

  const segments = segment(store, opts?.segment);
  return { wasm, store, segments };
}

export interface SegmentSummary {
  segment: Segment;
  results: AnalyticResult[];
}

export interface LogSummary {
  totalEvents: number;
  durationSeconds: number;
  segmentCount: number;
  overall: AnalyticResult[];
  segments: SegmentSummary[];
}

/**
 * Compute the fast "summary first" report: summary-flagged analytics over the whole
 * log plus per-segment. This is what the Worker posts back before the full corpus is
 * available for scrubbing.
 */
export function buildSummary(
  parsed: ParsedLog,
  registry: AnalyticsRegistry,
  opts: { spellTable?: SpellTable } = {},
): LogSummary {
  const { store, segments } = parsed;
  const { spellTable } = opts;
  const summaryAnalytics = registry.summaryAnalytics();

  const overall = registry.run({ store, segments, ...(spellTable ? { spellTable } : {}) }, summaryAnalytics);

  const perSegment: SegmentSummary[] = segments.map((seg) => ({
    segment: seg,
    results: registry.run(
      { store, segments, range: { start: seg.startIdx, end: seg.endIdx }, ...(spellTable ? { spellTable } : {}) },
      summaryAnalytics,
    ),
  }));

  const durationSeconds =
    store.count > 0 ? (store.ts[store.count - 1]! - store.ts[0]!) / 1000 : 0;

  return {
    totalEvents: store.count,
    durationSeconds,
    segmentCount: segments.length,
    overall,
    segments: perSegment,
  };
}
