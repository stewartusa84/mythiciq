/// <reference lib="webworker" />
//
// Parse Worker. Runs the WASM parse off the main thread, streams the input into wasm
// memory with progress events, posts the SUMMARY first, then a full diagnostic REPORT
// (all analytics + phase timings), and keeps the columnar store resident to serve
// time-window scrubbing, per-event decoding, and search.
//
// Browser/Vite only: the WASM artifact URL and the spell-table JSON are bundler-resolved.
import wasmUrl from '@wow/parser-core/pkg/parser_core.wasm?url';
import mechanicsBundle from '@wow/data/mechanics';

import { instantiateParser, type ParserWasmExports } from '../wasm/loader.js';
import { ColumnStore } from '../columns/columnStore.js';
import { segment, enrichSegment, type Segment } from '../segments/segmenter.js';
import { dungeonEnemiesFor } from '../segments/enemyFacts.js';
import { segmentRuns, type Run } from '../segments/runs.js';
import { bucketBosses } from '../segments/raidBosses.js';
import { createRegistry, buildSummary, type ParsedLog } from '../pipeline.js';
import { discoverRemovals } from '../analytics/discovery.js';
import { ReplayModel, toReplayData, type ReplayModelData } from '../analytics/primitives/replayModel.js';
import { detectOwner, evaluateCustomMetrics, type OwnerInfo, type CustomMetricRule } from '../analytics/customMetrics.js';
import { buildRoster } from '../analytics/roster.js';
import { buildCombatants } from '../analytics/combatants.js';
import { windowRange } from '../query/timeWindow.js';
import { SpellTable } from '../spells/spellTable.js';
import { loadMechanics, tableFromBundle, type MechanicsBundle } from '../spells/mechanics.js';
import type {
  WorkerRequest,
  WorkerResponse,
  ParsePhase,
  PhaseTiming,
  SegmentReport,
  RunReport,
  EventMatch,
} from './protocol.js';

const ctx = self as unknown as DedicatedWorkerGlobalScope;
const registry = createRegistry();

// Mechanics table source: the live backend bundle when VITE_BACKEND_URL is set, else the build-time
// bundle (offline default). Pointing at the backend makes the curated table live without redeploying
// the client; loadMechanics falls back to the bundle on any fetch failure. Lazily memoized at first parse.
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL;
const MECHANICS_URL: string | undefined = BACKEND_URL ? `${BACKEND_URL}/api/mechanics` : undefined;
let mechanicsPromise: Promise<MechanicsBundle> | undefined;
function getMechanics(): Promise<MechanicsBundle> {
  return (mechanicsPromise ??= loadMechanics({
    url: MECHANICS_URL,
    fallback: mechanicsBundle as MechanicsBundle,
  }));
}
function getSpellTable(): Promise<SpellTable> {
  return getMechanics().then(tableFromBundle);
}

let wasm: ParserWasmExports | null = null;
let resident: ParsedLog | null = null;
let residentRuns: Run[] = [];
let residentOwner: OwnerInfo | null = null;
// In-flight parse, if any. Each incoming message is dispatched in its own async task (see ctx.onmessage),
// so a resident-requiring request (getReplayModel, query, …) can arrive WHILE a parse is mid-flight —
// `resident` is nulled at the top of handleParse and only reassigned near the end, leaving a window
// where the request would spuriously throw "before parse". Non-parse requests await this first so they
// transparently wait for the parse to finish instead of erroring (the bug behind the leaked /diag
// "Load replay" fallback in the MVP replay stage).
let parseInFlight: Promise<void> | null = null;
// Per-run replay models are a few MB each; cache by run index so re-selecting a run is instant.
const replayCache = new Map<number, ReplayModelData>();

const CHUNK = 8 * 1024 * 1024; // 8 MiB streaming chunks
const now = () => performance.now();

function post(msg: WorkerResponse, transfer?: Transferable[]): void {
  ctx.postMessage(msg, transfer ?? []);
}
function progress(phase: ParsePhase, ratio: number): void {
  post({ type: 'progress', phase, ratio });
}

async function getWasm(): Promise<ParserWasmExports> {
  if (wasm) return wasm;
  const bytes = await (await fetch(wasmUrl)).arrayBuffer();
  wasm = await instantiateParser(bytes);
  return wasm;
}

/** Stream a Blob/ArrayBuffer into wasm memory, returning [ptr, len]. */
async function loadIntoWasm(w: ParserWasmExports, payload: ArrayBuffer | Blob): Promise<[number, number]> {
  const total = payload instanceof Blob ? payload.size : payload.byteLength;
  const ptr = w.alloc(total);
  if (payload instanceof ArrayBuffer) {
    new Uint8Array(w.memory.buffer, ptr, total).set(new Uint8Array(payload));
    progress('read', 1);
    return [ptr, total];
  }
  let offset = 0;
  while (offset < total) {
    const end = Math.min(offset + CHUNK, total);
    const buf = new Uint8Array(await payload.slice(offset, end).arrayBuffer());
    new Uint8Array(w.memory.buffer, ptr + offset, buf.length).set(buf);
    offset = end;
    progress('read', total > 0 ? offset / total : 1);
  }
  return [ptr, total];
}

async function handleParse(payload: ArrayBuffer | Blob): Promise<void> {
  const [w, mechanics] = await Promise.all([getWasm(), getMechanics()]);
  const spellTable = tableFromBundle(mechanics);
  const enemyDb = mechanics.enemies;
  w.reset();
  resident = null;
  const phases: PhaseTiming[] = [];

  let t0 = now();
  const [ptr, len] = await loadIntoWasm(w, payload);
  phases.push({ name: 'read', ms: now() - t0 });

  progress('parse', 0);
  t0 = now();
  w.parse(ptr, len);
  const store = new ColumnStore(w);
  w.dealloc(ptr, len);
  phases.push({ name: 'parse+views', ms: now() - t0 });
  progress('parse', 1);

  progress('segment', 0);
  t0 = now();
  const segments: Segment[] = segment(store);
  // Split the log into per-dungeon runs (CHALLENGE_MODE_START..END). A dropped log can hold a
  // whole night of keys; each becomes its own report + replay so the app presents them separately.
  const runs: Run[] = segmentRuns(store);
  phases.push({ name: 'segment', ms: now() - t0 });
  progress('segment', 1);

  resident = { wasm: w, store, segments };
  residentRuns = runs;
  residentOwner = detectOwner(store);
  replayCache.clear();

  progress('summary', 0);
  const summary = buildSummary(resident, registry, { spellTable });
  post({ type: 'summary', summary });
  progress('summary', 1);

  // Full diagnostic report: EVERY analytic, per run (overall over the run) and per pull within it.
  t0 = now();
  const all = registry.all();
  const runReports: RunReport[] = runs.map((run) => {
    const range = { start: run.startIdx, end: run.endIdx };
    const overall = registry.run({ store, segments, range, spellTable }, all);
    // Pulls belonging to this run (segments fully inside the run's event range).
    const runSegments = segments.filter((s) => s.startIdx >= run.startIdx && s.endIdx <= run.endIdx);
    // Enrich trash pulls with MDT enemy facts for this run's dungeon (M+ only; raids have no MDT facts).
    if (run.contentType !== 'raid') {
      const dungeonFacts = dungeonEnemiesFor(enemyDb, run.dungeonName);
      for (const s of runSegments) enrichSegment(s, dungeonFacts);
    }
    const segReports: SegmentReport[] = runSegments.map((seg) => ({
      segment: seg,
      results: registry.run(
        { store, segments, range: { start: seg.startIdx, end: seg.endIdx }, spellTable },
        all,
      ),
    }));
    // Raid sessions: bucket the run's encounter pulls by boss (wipes + kill = attempts).
    const bosses = run.contentType === 'raid' ? bucketBosses(runSegments) : undefined;
    return {
      run,
      totalEvents: run.endIdx - run.startIdx,
      firstMs: run.startMs,
      lastMs: run.endMs,
      durationSeconds: (run.endMs - run.startMs) / 1000,
      overall,
      segments: segReports,
      ...(bosses !== undefined ? { bosses } : {}),
      roster: buildRoster(store, range),
      combatants: buildCombatants(store, range),
    };
  });
  phases.push({ name: 'analytics(all)', ms: now() - t0 });

  const firstMs = store.count > 0 ? store.ts[0]! : 0;
  const lastMs = store.count > 0 ? store.ts[store.count - 1]! : 0;
  const durationSeconds = (lastMs - firstMs) / 1000;
  post({
    type: 'report',
    report: {
      phases,
      totalEvents: store.count,
      durationSeconds,
      firstMs,
      lastMs,
      runs: runReports,
      owner: residentOwner,
      roster: buildRoster(store),
    },
  });

  // Removal discovery: removals the table can't explain (novel removers / debuffs / capability gaps).
  // Stored locally by the app for now; later POSTed to the backend to grow the curated table.
  const discoveries = discoverRemovals(store, spellTable);
  if (discoveries.length > 0) post({ type: 'discovery', discoveries });

  post({ type: 'ready', totalEvents: store.count });
}

function handleQuery(id: number, startMs: number, endMs: number): void {
  if (!resident) throw new Error('query before parse');
  const range = windowRange(resident.store.ts, startMs, endMs);
  post({ type: 'queryResult', id, range, eventCount: range.end - range.start });
}

function handleGetEvent(id: number, index: number): void {
  if (!resident) throw new Error('getEvent before parse');
  const s = resident.store;
  const event = index >= 0 && index < s.count ? s.decodeEvent(index) : null;
  post({ type: 'event', id, event });
}

function handleGetEvents(id: number, startMs: number, endMs: number, limit: number): void {
  if (!resident) throw new Error('getEvents before parse');
  const s = resident.store;
  const range = windowRange(s.ts, startMs, endMs);
  const events = [];
  let truncated = false;
  for (let i = range.start; i < range.end; i++) {
    if (events.length >= limit) {
      truncated = true;
      break;
    }
    events.push(s.decodeEvent(i));
  }
  post({ type: 'events', id, range, events, truncated });
}

function handleSearch(id: number, query: string, limit: number): void {
  if (!resident) throw new Error('search before parse');
  const s = resident.store;
  const q = query.trim().toLowerCase();
  const asNum = /^\d+$/.test(q) ? Number(q) : null;
  const matches: EventMatch[] = [];
  let truncated = false;

  for (let i = 0; i < s.count; i++) {
    if (matches.length >= limit) {
      truncated = true;
      break;
    }
    let hit = q === ''; // empty query -> first N events
    if (!hit && asNum !== null) {
      hit = i === asNum || s.spellIdNum(i) === asNum;
    }
    if (!hit && q !== '') {
      const et = s.eventTypeName(s.eventType[i]!).toLowerCase();
      const src = s.unitLabel(s.sourceGuid[i]!).toLowerCase();
      const tgt = s.unitLabel(s.targetGuid[i]!).toLowerCase();
      const sp = (s.spellNameId[i]! ? s.str(s.spellNameId[i]!) : '').toLowerCase();
      hit = et.includes(q) || src.includes(q) || tgt.includes(q) || sp.includes(q);
    }
    if (hit) {
      const spId = s.spellIdNum(i);
      matches.push({
        index: i,
        tsMs: s.ts[i]!,
        eventType: s.eventTypeName(s.eventType[i]!),
        source: s.unitLabel(s.sourceGuid[i]!),
        target: s.unitLabel(s.targetGuid[i]!),
        spell: s.spellNameId[i]! ? s.str(s.spellNameId[i]!) : spId !== null ? `spell:${spId}` : '',
      });
    }
  }
  post({ type: 'searchResult', id, matches, truncated });
}

async function handleGetReplayModel(id: number, runIndex: number): Promise<void> {
  if (!resident) throw new Error('getReplayModel before parse');
  const run = residentRuns[runIndex];
  if (!run) throw new Error(`getReplayModel: no run #${runIndex}`);

  let data = replayCache.get(runIndex);
  if (!data) {
    const spellTable = await getSpellTable();
    const range = { start: run.startIdx, end: run.endIdx };
    const model = ReplayModel.build(resident.store, range);
    data = toReplayData(model, resident.store, spellTable, range);
    replayCache.set(runIndex, data);
  }
  post({ type: 'replayModel', id, data });
}

function handleEvaluateMetrics(id: number, rules: CustomMetricRule[], runIndex: number): void {
  if (!resident) throw new Error('evaluateMetrics before parse');
  const run = residentRuns[runIndex];
  const range = run ? { start: run.startIdx, end: run.endIdx } : undefined;
  const report = evaluateCustomMetrics(resident.store, rules, range);
  post({ type: 'metricsResult', id, report });
}

ctx.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  // Track a parse so concurrent resident-requiring requests can wait for it. Assigned synchronously
  // here — handleParse runs up to its first await before returning the promise — so any message the
  // loop dispatches AFTER this one already sees parseInFlight set.
  if (msg.type === 'parse') parseInFlight = handleParse(msg.payload);
  (async () => {
    try {
      // Any non-parse request that needs the resident store waits for an in-flight parse rather than
      // racing it (the "before parse" transient that leaked the diagnostic Load-replay fallback).
      if (msg.type !== 'parse' && parseInFlight) {
        try {
          await parseInFlight;
        } catch {
          /* the parse failed; fall through and let the handler's own resident check report it */
        }
      }
      switch (msg.type) {
        case 'parse': {
          const p = parseInFlight;
          try {
            await p;
          } finally {
            if (parseInFlight === p) parseInFlight = null; // identity-guarded so a newer parse isn't clobbered
          }
          break;
        }
        case 'query':
          handleQuery(msg.id, msg.startMs, msg.endMs);
          break;
        case 'getEvent':
          handleGetEvent(msg.id, msg.index);
          break;
        case 'getEvents':
          handleGetEvents(msg.id, msg.startMs, msg.endMs, msg.limit);
          break;
        case 'search':
          handleSearch(msg.id, msg.query, msg.limit);
          break;
        case 'getReplayModel':
          await handleGetReplayModel(msg.id, msg.runIndex);
          break;
        case 'evaluateMetrics':
          handleEvaluateMetrics(msg.id, msg.rules, msg.runIndex);
          break;
      }
    } catch (err) {
      // Correlate the failure to the request id (if any) so the client rejects that exact promise
      // instead of leaving it hanging forever.
      const id = 'id' in msg ? msg.id : undefined;
      post({ type: 'error', ...(id !== undefined ? { id } : {}), message: err instanceof Error ? err.message : String(err) });
    }
  })();
};
