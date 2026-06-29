/**
 * Per-dungeon Mythic+ time limits (the "par" timer), keyed by the CHALLENGE_MODE
 * `challengeModeId` (the MapChallengeMode id — CHALLENGE_MODE_START field 3; this is MDT's
 * `mapID` in `packages/data/dungeons/*.lua`).
 *
 * WHY THIS IS CURATED DATA (not read from the log): the combat log's `CHALLENGE_MODE_END`
 * does NOT carry the dungeon timer. Its row is
 *   `mapId, success, keystoneLevel, totalTimeMs, <runScore>, <newOverallRating>`
 * — the two trailing floats are the RUN's dungeon score and the player's NEW OVERALL M+
 * rating, NOT a timer. (Verified across the sample logs: both climb monotonically across a
 * night of keys, and the SAME dungeon shows different trailing values on different days — a
 * timer can't do that.) So the timer has to live here.
 *
 * Chest / star upgrade thresholds (Blizzard standard, fraction of the timer):
 *   ≤100% → +1 (Timed, ★)   ≤80% → +2 (★★)   ≤60% → +3 (★★★)   >100% → 0 (over time / depleted)
 *
 * ⚠ THESE VALUES ARE BEST-EFFORT ESTIMATES — edit them to the real Midnight timers. They
 * drive the star rating on the run header; an unmapped dungeon (or a wrong value) just shows
 * "Completed" with no/incorrect stars, it does not break anything. challengeModeIds below are
 * the verified ids from the dungeon Lua / sample logs.
 */
export const CHALLENGE_TIMERS_SECONDS: Record<number, number> = {
  161: 32 * 60, // Skyreach — estimate, verify
  239: 32 * 60, // Seat of the Triumvirate — estimate, verify
  402: 32 * 60, // Algeth'ar Academy — estimate, verify
  556: 31 * 60, // Pit of Saron — estimate, verify
  557: 33 * 60, // Windrunner Spire — estimate, verify
  558: 30 * 60, // Magisters' Terrace — estimate, verify
  559: 30 * 60, // Nexus-Point Xenas — estimate, verify
  560: 33 * 60, // Maisara Caverns — estimate, verify
};

/** Timer in seconds for a run, looked up by challengeModeId (the stable key). */
export function timerSecondsFor(challengeModeId?: number): number | undefined {
  if (challengeModeId !== undefined && CHALLENGE_TIMERS_SECONDS[challengeModeId] !== undefined) {
    return CHALLENGE_TIMERS_SECONDS[challengeModeId];
  }
  return undefined;
}

/**
 * Chests / stars earned (0–3) for a completion, from total time vs the dungeon timer.
 * 0 = completed but over the timer (key depletes). 1/2/3 = the Blizzard upgrade thresholds.
 */
export function chestsFor(totalTimeMs: number, timerSeconds: number): number {
  const timerMs = timerSeconds * 1000;
  if (timerMs <= 0) return 0;
  if (totalTimeMs <= timerMs * 0.6) return 3;
  if (totalTimeMs <= timerMs * 0.8) return 2;
  if (totalTimeMs <= timerMs) return 1;
  return 0;
}
