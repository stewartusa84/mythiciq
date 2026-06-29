import type { Segment } from './segmenter.js';

/**
 * One attempt at a boss (a single `ENCOUNTER_START..END` pull). `segmentIndex` is the GLOBAL
 * `Segment.index` so the app can pull the attempt's per-pull analytics straight out of
 * `RunReport.segments` (the same lookup-by-index convention the Analytics panel uses), and seek the
 * replay to `[startMs, endMs]`.
 */
export interface RaidAttempt {
  segmentIndex: number;
  startMs: number;
  endMs: number;
  durationMs: number;
  /** True = boss kill, false = wipe (from ENCOUNTER_END `success`). */
  success: boolean;
}

/**
 * All attempts at one boss, grouped. A raid session has one bucket per distinct encounter, each
 * holding its wipes + (if it died) the kill — matching how raiders think ("Council, 4 pulls").
 */
export interface BossBucket {
  encounterId: number;
  name: string;
  /** Encounter difficultyId (14/15/16/17), from the first attempt — all attempts share it. */
  difficultyId?: number;
  attempts: RaidAttempt[];
  /** Number of attempts (wipes + kill). */
  pulls: number;
  /** Whether the boss was killed in any attempt. */
  killed: boolean;
  /** Duration (ms) of the killing pull, if killed. */
  killTimeMs?: number;
}

/**
 * Bucket a raid run's `encounter` segments by `encounterId`, preserving first-occurrence order
 * (so the list reads in raid-progression order). Non-encounter segments (trash) are ignored — raid
 * trash bucketing is a deferred follow-up. Pure: no store access, just the already-built segments.
 */
export function bucketBosses(segments: Segment[]): BossBucket[] {
  const order: number[] = [];
  const byId = new Map<number, BossBucket>();

  for (const s of segments) {
    if (s.kind !== 'encounter' || s.encounterId === undefined) continue;
    const success = s.success === true;
    const attempt: RaidAttempt = {
      segmentIndex: s.index,
      startMs: s.startMs,
      endMs: s.endMs,
      durationMs: s.durationMs,
      success,
    };

    let bucket = byId.get(s.encounterId);
    if (!bucket) {
      bucket = {
        encounterId: s.encounterId,
        name: s.name ?? `Encounter ${s.encounterId}`,
        ...(s.difficultyId !== undefined ? { difficultyId: s.difficultyId } : {}),
        attempts: [],
        pulls: 0,
        killed: false,
      };
      byId.set(s.encounterId, bucket);
      order.push(s.encounterId);
    }
    bucket.attempts.push(attempt);
    bucket.pulls = bucket.attempts.length;
    if (success) {
      bucket.killed = true;
      bucket.killTimeMs = attempt.durationMs;
    }
  }

  return order.map((id) => byId.get(id)!);
}
