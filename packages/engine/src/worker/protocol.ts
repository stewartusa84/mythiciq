import type { LogSummary } from '../pipeline.js';
import type { IndexRange } from '../query/timeWindow.js';
import type { AnalyticResult } from '../analytics/types.js';
import type { RemovalDiscovery } from '../analytics/discovery.js';
import type { Segment } from '../segments/segmenter.js';
import type { Run } from '../segments/runs.js';
import type { BossBucket } from '../segments/raidBosses.js';
import type { DecodedEvent } from '../columns/columnStore.js';
import type { ReplayModelData } from '../analytics/primitives/replayModel.js';
import type { CustomMetricRule, CustomMetricsReport, OwnerInfo } from '../analytics/customMetrics.js';
import type { RosterEntry } from '../analytics/roster.js';
import type { CombatantInfo } from '../analytics/combatants.js';

/** Phases reported during a parse, for progress UI. */
export type ParsePhase = 'read' | 'parse' | 'segment' | 'summary';

export interface PhaseTiming {
  name: string;
  ms: number;
}

export interface SegmentReport {
  segment: Segment;
  results: AnalyticResult[];
}

/**
 * One dungeon run's diagnostic report: the run metadata + ALL analytics computed over the run
 * (overall) and per pull (segments scoped to the run). Shaped so the per-run panels can consume
 * it directly (overall/segments/firstMs/lastMs/totalEvents/durationSeconds).
 */
export interface RunReport {
  run: Run;
  totalEvents: number;
  /** epoch ms of the run's first / last event (the scrubber's time anchor) */
  firstMs: number;
  lastMs: number;
  durationSeconds: number;
  overall: AnalyticResult[];
  segments: SegmentReport[];
  /** Raid sessions only: the run's encounter pulls bucketed by boss (wipes + kill = attempts).
   *  Absent for M+ / synthetic runs. Each attempt references `segments` by `segmentIndex`. */
  bosses?: BossBucket[];
  /** This run's PARTY (players with COMBATANT_INFO in the run) — scoped per-run so a multi-key log
   *  doesn't blend rosters across runs. Use this for per-run panels; FullReport.roster is whole-log. */
  roster: RosterEntry[];
  /** This run's party with COMBATANT_INFO detail (spec, stats, talents, gear) — scoped per-run. */
  combatants: CombatantInfo[];
}

/** Full diagnostic report: per-phase timings (whole-log) + one RunReport per dungeon instance. */
export interface FullReport {
  phases: PhaseTiming[];
  /** whole-log totals (across every run) */
  totalEvents: number;
  durationSeconds: number;
  /** epoch ms of the first / last event in the whole log */
  firstMs: number;
  lastMs: number;
  /** One report per dungeon run, in log (chronological) order. */
  runs: RunReport[];
  /** Who recorded the log (affiliation MINE), for the custom-metrics "self" target. */
  owner: OwnerInfo | null;
  /** All players (name + role) for the anonymize / streaming-privacy name→alias map. */
  roster: RosterEntry[];
}

/** Brief event descriptor returned by search. */
export interface EventMatch {
  index: number;
  tsMs: number;
  eventType: string;
  source: string;
  target: string;
  spell: string;
}

// ---- main thread -> worker ----
export type WorkerRequest =
  | { type: 'parse'; payload: ArrayBuffer | Blob }
  | { type: 'query'; id: number; startMs: number; endMs: number }
  | { type: 'getEvent'; id: number; index: number }
  | { type: 'getEvents'; id: number; startMs: number; endMs: number; limit: number }
  | { type: 'search'; id: number; query: string; limit: number }
  | { type: 'getReplayModel'; id: number; runIndex: number }
  | { type: 'evaluateMetrics'; id: number; rules: CustomMetricRule[]; runIndex: number };

// ---- worker -> main thread ----
export type WorkerResponse =
  | { type: 'progress'; phase: ParsePhase; ratio: number }
  /** Summary is posted FIRST, as soon as it is computable. */
  | { type: 'summary'; summary: LogSummary }
  /** Full diagnostic report (all analytics + phase timings). */
  | { type: 'report'; report: FullReport }
  /** Removals the curated table can't explain — candidates to enrich the table / send to backend. */
  | { type: 'discovery'; discoveries: RemovalDiscovery[] }
  /** Full corpus indexed and resident; scrubbing queries can now be served. */
  | { type: 'ready'; totalEvents: number }
  | { type: 'queryResult'; id: number; range: IndexRange; eventCount: number }
  | { type: 'event'; id: number; event: DecodedEvent | null }
  | { type: 'events'; id: number; range: IndexRange; events: DecodedEvent[]; truncated: boolean }
  | { type: 'searchResult'; id: number; matches: EventMatch[]; truncated: boolean }
  | { type: 'replayModel'; id: number; data: ReplayModelData }
  | { type: 'metricsResult'; id: number; report: CustomMetricsReport }
  /** `id` is set when the error aborted a specific correlated request (so it can reject that promise);
   *  absent for a parse-time / global failure. */
  | { type: 'error'; id?: number; message: string };
