/**
 * Instance difficulty vocabulary, keyed by the combat-log `difficultyId` carried on
 * `ENCOUNTER_START` / `ENCOUNTER_END` (field 3). Used to tell a Mythic+ key apart from a raid
 * (and to label the raid difficulty in the run header).
 *
 * The ids are Blizzard's `DifficultyID`:
 *   1  Normal (dungeon)        2  Heroic (dungeon)
 *   8  Mythic Keystone (M+)    23 Mythic (dungeon)
 *   14 Normal (raid)           15 Heroic (raid)   16 Mythic (raid)   17 LFR (raid)
 * Only the raid set drives `contentType: 'raid'` — see `segments/runs.ts`. (M+ logs are detected by
 * the presence of `CHALLENGE_MODE_START`, not by difficulty 8, so the M+ run model is unaffected.)
 */
export const RAID_DIFFICULTY_IDS = new Set([14, 15, 16, 17]);
export const MYTHIC_PLUS_DIFFICULTY = 8;

const DIFFICULTY_NAMES: Record<number, string> = {
  1: 'Normal',
  2: 'Heroic',
  8: 'Mythic+',
  14: 'Normal',
  15: 'Heroic',
  16: 'Mythic',
  17: 'LFR',
  23: 'Mythic',
};

/** Human label for a difficulty id (e.g. 15 → 'Heroic'); undefined for an unknown id. */
export function difficultyName(id?: number): string | undefined {
  return id !== undefined ? DIFFICULTY_NAMES[id] : undefined;
}

/** True when the difficulty id is one of the raid difficulties (Normal/Heroic/Mythic/LFR). */
export function isRaidDifficulty(id?: number): boolean {
  return id !== undefined && RAID_DIFFICULTY_IDS.has(id);
}
