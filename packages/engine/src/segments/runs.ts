import { ColumnStore } from '../columns/columnStore.js';
import { timerSecondsFor, chestsFor } from './challengeTimers.js';
import { difficultyName, isRaidDifficulty } from './difficulty.js';

/** What kind of content a Run represents. Drives M+-vs-raid framing in the app (header, run model,
 *  which panels self-hide). 'other' is the non-M+/non-raid synthetic whole-log fallback. */
export type ContentType = 'mplus' | 'raid' | 'other';

/**
 * A single instance within a log. For Mythic+ this is one dungeon run, bracketed by
 * `CHALLENGE_MODE_START` .. `CHALLENGE_MODE_END`. For raids — which have NO challenge-mode
 * bracket — it's one **raid session**: a contiguous block of `ENCOUNTER_START..END` boss pulls in
 * the same instance, with the bosses bucketed (see `raidBosses.ts`) rather than scored as a key.
 * A combat log dropped in by a player can contain several of these (a night of keys, or M+ then a
 * raid); each becomes its own Run so the app can present per-instance metrics / replay rather than
 * one blended whole-log view.
 *
 * The event range is half-open [startIdx, endIdx): for M+, from the CHALLENGE_MODE_START row (so
 * COMBATANT_INFO, affixes, etc. are included) through the CHALLENGE_MODE_END row (inclusive); for a
 * raid, from the first boss pull's ENCOUNTER_START through the last pull's ENCOUNTER_END (so the
 * whole session, including downtime between bosses, is the run's window).
 */
export interface Run {
  index: number;
  /** Content kind — 'mplus' (challenge-mode), 'raid' (encounter sessions), or 'other' (synthetic). */
  contentType: ContentType;
  /** half-open event range [startIdx, endIdx) into the columns */
  startIdx: number;
  endIdx: number;
  startMs: number;
  endMs: number;
  durationMs: number;
  // CHALLENGE_MODE_START metadata (M+ only)
  dungeonName?: string;
  mapId?: number;
  challengeModeId?: number;
  keystoneLevel?: number;
  // Raid-session metadata (raid only)
  /** Encounter difficultyId for the session (14 Normal / 15 Heroic / 16 Mythic / 17 LFR). */
  difficultyId?: number;
  /** Human difficulty label (e.g. 'Heroic'), derived from `difficultyId`. */
  difficultyName?: string;
  /** Raid instance id (ENCOUNTER_START field 5), the session-grouping key. */
  instanceId?: number;
  /** Raid/zone name from the nearest preceding ZONE_CHANGE (the session's displayed title). */
  instanceName?: string;
  /** Affix ids for the key (drives the death-penalty gate etc.). Empty for raids. */
  affixes: number[];
  // CHALLENGE_MODE_END metadata (absent if the run was abandoned / log cut off)
  /** Whether the key was completed (in time or otherwise) — from CHALLENGE_MODE_END `success`. */
  completed?: boolean;
  /** Total run time in ms from CHALLENGE_MODE_END `totalTimeMs`, if present. */
  completionTimeMs?: number;
  /**
   * Whether the key was abandoned / not completed. True when the run ended without a
   * successful CHALLENGE_MODE_END — either an explicit `success=0` END (the game's reset
   * row, emitted when a key is dropped to re-roll) or no END at all followed by a LATER run
   * starting (the group moved on to another key). The last run with no END stays ambiguous
   * (`completed`/`abandoned` both undefined ⇒ "in progress" — the log may just be cut off).
   */
  abandoned?: boolean;
  /** Dungeon timer in ms (curated, by challengeModeId — see challengeTimers.ts), if known. */
  timerMs?: number;
  /**
   * Chests / stars earned (0–3) for a timed completion: ≤100%/80%/60% of the timer = 1/2/3,
   * 0 = completed over time. Only set when `completed` AND `timerMs` are known.
   */
  chests?: number;
  /** True when this is the synthetic whole-log fallback (no CHALLENGE_MODE bracket in the log). */
  synthetic?: boolean;
}

/**
 * Split a log into per-instance runs.
 *
 * M+: each `CHALLENGE_MODE_START` opens a run that closes at its matching `CHALLENGE_MODE_END`
 * (inclusive) — or at the next run / end of log if the key was abandoned.
 *
 * Raid: there is no challenge-mode bracket, so a contiguous block of raid-difficulty
 * `ENCOUNTER_START..END` pulls sharing the same `instanceId` (that isn't inside an M+ run) becomes
 * one **raid session** run; the bosses are bucketed downstream (`raidBosses.ts`).
 *
 * If the log has neither (a fixture / world content), a single synthetic `'other'` run spanning the
 * whole store is returned so every downstream consumer still works. Runs are returned in log order.
 */
export function segmentRuns(store: ColumnStore): Run[] {
  const { ts, count } = store;
  if (count === 0) return [];

  const mplus = mplusRuns(store);
  const raid = raidRuns(store, mplus);
  const runs = [...mplus, ...raid];

  // No key start AND no raid encounters → treat the whole log as one synthetic run.
  if (runs.length === 0) {
    return [
      {
        index: 0,
        contentType: 'other',
        startIdx: 0,
        endIdx: count,
        startMs: ts[0]!,
        endMs: ts[count - 1]!,
        durationMs: ts[count - 1]! - ts[0]!,
        affixes: [],
        synthetic: true,
      },
    ];
  }

  runs.sort((a, b) => a.startIdx - b.startIdx);
  runs.forEach((r, i) => (r.index = i));
  return runs;
}

/** Mythic+ runs: CHALLENGE_MODE_START..END brackets (a night of keys → several runs). */
function mplusRuns(store: ColumnStore): Run[] {
  const { eventType, ts, count } = store;
  const cmStart = store.eventTypeId('CHALLENGE_MODE_START');
  const cmEnd = store.eventTypeId('CHALLENGE_MODE_END');

  const startIdxs: number[] = [];
  if (cmStart !== undefined) {
    for (let i = 0; i < count; i++) if (eventType[i] === cmStart) startIdxs.push(i);
  }
  if (startIdxs.length === 0) return [];

  const runs: Run[] = [];
  for (let k = 0; k < startIdxs.length; k++) {
    const startIdx = startIdxs[k]!;
    const nextStart = startIdxs[k + 1] ?? count;

    // Find the matching CHALLENGE_MODE_END before the next run begins.
    let endIdx = nextStart;
    let completed: boolean | undefined;
    let completionTimeMs: number | undefined;
    if (cmEnd !== undefined) {
      for (let j = startIdx + 1; j < nextStart; j++) {
        if (eventType[j] !== cmEnd) continue;
        endIdx = j + 1; // include the END row
        const s = store.detail(j, 'success');
        completed = typeof s === 'boolean' ? s : s === 1;
        const tt = store.detail(j, 'totalTimeMs');
        if (typeof tt === 'number') completionTimeMs = tt;
        break;
      }
    }

    const dungeonName = strOr(store.detail(startIdx, 'dungeonName'));
    const mapId = numOr(store.detail(startIdx, 'mapId'));
    const challengeModeId = numOr(store.detail(startIdx, 'challengeModeId'));
    const keystoneLevel = numOr(store.detail(startIdx, 'keystoneLevel'));
    const affixesRaw = store.detail(startIdx, 'affixes');
    const affixes = Array.isArray(affixesRaw) ? (affixesRaw as number[]) : [];

    // Abandoned = explicit success=0 END, or no END at all but a LATER run starts (they
    // moved on). A no-END last run stays ambiguous (in progress — log may be truncated).
    const hasLaterRun = k + 1 < startIdxs.length;
    const abandoned = completed === false || (completed === undefined && hasLaterRun);

    // Stars/chests from total time vs the curated dungeon timer (only for real completions).
    const timerSeconds = timerSecondsFor(challengeModeId);
    const timerMs = timerSeconds !== undefined ? timerSeconds * 1000 : undefined;
    const chests =
      completed === true && completionTimeMs !== undefined && timerSeconds !== undefined
        ? chestsFor(completionTimeMs, timerSeconds)
        : undefined;

    runs.push({
      index: runs.length,
      contentType: 'mplus',
      startIdx,
      endIdx,
      startMs: ts[startIdx]!,
      endMs: ts[endIdx - 1]!,
      durationMs: ts[endIdx - 1]! - ts[startIdx]!,
      ...(dungeonName !== undefined ? { dungeonName } : {}),
      ...(mapId !== undefined ? { mapId } : {}),
      ...(challengeModeId !== undefined ? { challengeModeId } : {}),
      ...(keystoneLevel !== undefined ? { keystoneLevel } : {}),
      affixes,
      ...(completed !== undefined ? { completed } : {}),
      ...(completionTimeMs !== undefined ? { completionTimeMs } : {}),
      ...(abandoned ? { abandoned } : {}),
      ...(timerMs !== undefined ? { timerMs } : {}),
      ...(chests !== undefined ? { chests } : {}),
    });
  }
  return runs;
}

/**
 * Raid sessions: group contiguous raid-difficulty `ENCOUNTER_START..END` pulls (that don't fall
 * inside any M+ run) by `instanceId`. Each group is one session spanning its first pull's start
 * through its last pull's end. `mplusRuns` is passed in so encounters inside a key (M+ bosses) are
 * skipped — a log can hold both M+ and raid on the same night.
 */
function raidRuns(store: ColumnStore, mplus: Run[]): Run[] {
  const { eventType, ts, count } = store;
  const encStart = store.eventTypeId('ENCOUNTER_START');
  const encEnd = store.eventTypeId('ENCOUNTER_END');
  const zoneChange = store.eventTypeId('ZONE_CHANGE');
  if (encStart === undefined) return [];

  const inMplus = (i: number): boolean =>
    mplus.some((r) => i >= r.startIdx && i < r.endIdx);

  // Zone names (idx → name) so a session can label itself from the nearest preceding ZONE_CHANGE.
  const zones: { idx: number; name: string }[] = [];
  if (zoneChange !== undefined) {
    for (let i = 0; i < count; i++) {
      if (eventType[i] !== zoneChange) continue;
      const name = strOr(store.detail(i, 'zoneName'));
      if (name !== undefined) zones.push({ idx: i, name });
    }
  }
  const zoneNameBefore = (idx: number): string | undefined => {
    let name: string | undefined;
    for (const z of zones) {
      if (z.idx > idx) break;
      name = z.name;
    }
    return name;
  };

  // Collect raid boss pulls in order: each ENCOUNTER_START (raid difficulty, outside any key) +
  // its matching ENCOUNTER_END end index.
  interface Pull {
    startIdx: number;
    endIdx: number;
    difficultyId?: number;
    instanceId?: number;
  }
  const pulls: Pull[] = [];
  for (let i = 0; i < count; i++) {
    if (eventType[i] !== encStart) continue;
    const difficultyId = numOr(store.detail(i, 'difficultyId'));
    if (!isRaidDifficulty(difficultyId) || inMplus(i)) continue;

    let endIdx = count;
    if (encEnd !== undefined) {
      for (let j = i + 1; j < count; j++) {
        if (eventType[j] === encStart) {
          endIdx = j;
          break;
        }
        if (eventType[j] === encEnd) {
          endIdx = j + 1; // include the END row
          break;
        }
      }
    }
    pulls.push({
      startIdx: i,
      endIdx,
      ...(difficultyId !== undefined ? { difficultyId } : {}),
      ...(numOr(store.detail(i, 'instanceId')) !== undefined
        ? { instanceId: numOr(store.detail(i, 'instanceId')) }
        : {}),
    });
  }
  if (pulls.length === 0) return [];

  // Group consecutive pulls into sessions by instanceId (an undefined id continues the current one).
  const runs: Run[] = [];
  let group: Pull[] = [];
  const flush = () => {
    if (group.length === 0) return;
    const first = group[0]!;
    const last = group[group.length - 1]!;
    const instanceName = zoneNameBefore(first.startIdx);
    runs.push({
      index: 0,
      contentType: 'raid',
      startIdx: first.startIdx,
      endIdx: last.endIdx,
      startMs: ts[first.startIdx]!,
      endMs: ts[last.endIdx - 1]!,
      durationMs: ts[last.endIdx - 1]! - ts[first.startIdx]!,
      ...(first.difficultyId !== undefined ? { difficultyId: first.difficultyId } : {}),
      ...(difficultyName(first.difficultyId) !== undefined
        ? { difficultyName: difficultyName(first.difficultyId) }
        : {}),
      ...(first.instanceId !== undefined ? { instanceId: first.instanceId } : {}),
      ...(instanceName !== undefined ? { instanceName } : {}),
      affixes: [],
    });
    group = [];
  };
  for (const p of pulls) {
    if (group.length > 0) {
      const cur = group[0]!.instanceId;
      // Break the session when a defined instanceId differs from the current group's.
      if (p.instanceId !== undefined && cur !== undefined && p.instanceId !== cur) flush();
    }
    group.push(p);
  }
  flush();
  return runs;
}

function numOr(v: unknown): number | undefined {
  return typeof v === 'number' ? v : undefined;
}
function strOr(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}
