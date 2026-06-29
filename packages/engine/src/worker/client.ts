import type { LogSummary } from '../pipeline.js';
import type { IndexRange } from '../query/timeWindow.js';
import type { DecodedEvent } from '../columns/columnStore.js';
import type { RemovalDiscovery } from '../analytics/discovery.js';
import type { ReplayModelData } from '../analytics/primitives/replayModel.js';
import type { CustomMetricRule, CustomMetricsReport } from '../analytics/customMetrics.js';
import type {
  ParsePhase,
  WorkerRequest,
  WorkerResponse,
  FullReport,
  EventMatch,
} from './protocol.js';

export interface ParseHandlers {
  onProgress?: (phase: ParsePhase, ratio: number) => void;
  /** Full diagnostic report (all analytics + phase timings). */
  onReport?: (report: FullReport) => void;
  /** Removals the curated table can't explain (only fires when there are any). */
  onDiscovery?: (discoveries: RemovalDiscovery[]) => void;
  /** Fires when the full corpus is resident (scrubbing queries are now valid). */
  onReady?: (totalEvents: number) => void;
}

export interface WindowEvents {
  range: IndexRange;
  events: DecodedEvent[];
  truncated: boolean;
}
export interface SearchResult {
  matches: EventMatch[];
  truncated: boolean;
}

/**
 * Framework-agnostic main-thread client for the parse Worker. `parse()` resolves with
 * the SUMMARY (summary-first); `onReport` then delivers the full diagnostic report. The
 * worker keeps the corpus resident, so `query`/`getEvent`/`getEvents`/`search` scrub it.
 */
export class ParserClient {
  private readonly worker: Worker;
  private reqId = 0;
  private readonly pending = new Map<number, { onMessage: (msg: WorkerResponse) => void; onError: (e: Error) => void }>();

  private parseResolve?: (s: LogSummary) => void;
  private parseReject?: (e: Error) => void;
  private handlers: ParseHandlers = {};

  constructor(worker?: Worker) {
    this.worker =
      worker ?? new Worker(new URL('./parse.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => this.onMessage(e.data);
  }

  parse(payload: ArrayBuffer | Blob, handlers: ParseHandlers = {}): Promise<LogSummary> {
    this.handlers = handlers;
    return new Promise<LogSummary>((resolve, reject) => {
      this.parseResolve = resolve;
      this.parseReject = reject;
      const req: WorkerRequest = { type: 'parse', payload };
      // Transfer an ArrayBuffer (avoid clone); a File/Blob is passed by reference.
      this.worker.postMessage(req, payload instanceof ArrayBuffer ? [payload] : []);
    });
  }

  query(startMs: number, endMs: number): Promise<IndexRange> {
    return this.request<IndexRange>((id) => ({ type: 'query', id, startMs, endMs }), (m) =>
      m.type === 'queryResult' ? m.range : undefined,
    );
  }

  getEvent(index: number): Promise<DecodedEvent | null> {
    return this.request<DecodedEvent | null>((id) => ({ type: 'getEvent', id, index }), (m) =>
      m.type === 'event' ? m.event : undefined,
    );
  }

  getEvents(startMs: number, endMs: number, limit = 500): Promise<WindowEvents> {
    return this.request<WindowEvents>((id) => ({ type: 'getEvents', id, startMs, endMs, limit }), (m) =>
      m.type === 'events' ? { range: m.range, events: m.events, truncated: m.truncated } : undefined,
    );
  }

  search(query: string, limit = 200): Promise<SearchResult> {
    return this.request<SearchResult>((id) => ({ type: 'search', id, query, limit }), (m) =>
      m.type === 'searchResult' ? { matches: m.matches, truncated: m.truncated } : undefined,
    );
  }

  /** Build (once, cached) and fetch the replay model for run `runIndex` — per-unit aura/cast/HP
   *  timelines + kill feed scoped to that dungeon. Transferred as structured-cloned data the UI
   *  queries locally at 60fps. */
  getReplayModel(runIndex: number): Promise<ReplayModelData> {
    return this.request<ReplayModelData>((id) => ({ type: 'getReplayModel', id, runIndex }), (m) =>
      m.type === 'replayModel' ? m.data : undefined,
    );
  }

  /** Evaluate user-defined custom-metric rules against run `runIndex`, returning discovered windows. */
  evaluateMetrics(rules: CustomMetricRule[], runIndex: number): Promise<CustomMetricsReport> {
    return this.request<CustomMetricsReport>((id) => ({ type: 'evaluateMetrics', id, rules, runIndex }), (m) =>
      m.type === 'metricsResult' ? m.report : undefined,
    );
  }

  terminate(): void {
    this.worker.terminate();
  }

  /** Send a correlated request; resolve when `extract` returns a value, reject if the worker reports
   *  an error for this id (so a failed request surfaces instead of hanging forever). */
  private request<T>(
    build: (id: number) => WorkerRequest,
    extract: (msg: WorkerResponse) => T | undefined,
  ): Promise<T> {
    const id = ++this.reqId;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        onMessage: (msg) => {
          const v = extract(msg);
          if (v !== undefined) {
            this.pending.delete(id);
            resolve(v);
          }
        },
        onError: (e) => {
          this.pending.delete(id);
          reject(e);
        },
      });
      this.worker.postMessage(build(id));
    });
  }

  private onMessage(msg: WorkerResponse): void {
    switch (msg.type) {
      case 'progress':
        this.handlers.onProgress?.(msg.phase, msg.ratio);
        return;
      case 'summary':
        this.parseResolve?.(msg.summary);
        this.parseResolve = undefined;
        this.parseReject = undefined;
        return;
      case 'report':
        this.handlers.onReport?.(msg.report);
        return;
      case 'discovery':
        this.handlers.onDiscovery?.(msg.discoveries);
        return;
      case 'ready':
        this.handlers.onReady?.(msg.totalEvents);
        return;
      case 'error': {
        const err = new Error(msg.message);
        if (msg.id !== undefined && this.pending.has(msg.id)) {
          // A specific request failed → reject just that promise.
          this.pending.get(msg.id)!.onError(err);
        } else {
          // Parse-time / global failure → fail the parse and every in-flight request.
          this.parseReject?.(err);
          this.parseReject = undefined;
          this.parseResolve = undefined;
          for (const p of this.pending.values()) p.onError(err);
          this.pending.clear();
        }
        return;
      }
      case 'queryResult':
      case 'event':
      case 'events':
      case 'searchResult':
      case 'replayModel':
      case 'metricsResult': {
        this.pending.get(msg.id)?.onMessage(msg);
        return;
      }
    }
  }
}
