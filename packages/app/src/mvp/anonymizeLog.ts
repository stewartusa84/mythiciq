// Share-pipeline anonymizer: rewrite a single-run sub-log so no real player name remains before it is
// uploaded for a public-to-the-link discussion share. Uses the SAME role aliases the anonymize toggle
// shows (rosterAlias.ts), so a comment that says "DPS 3 should've bubbled" points at the player the
// shared replay labels "DPS 3". The heavy lifting (the lossless byte rewrite) lives in the engine
// (anonymizeLog) — this is the thin glue that builds the guid→alias map from a run's roster.
//
// Known gap (documented in the share UI): only Player- actors are aliased. Generic pet names (e.g.
// "Treant") aren't identifying; a player-renamed hunter pet is a small residual leak — pet→owner
// aliasing is a follow-up.
import type { RosterEntry } from '@wow/engine';
import { anonymizeLog } from '@wow/engine';
import { guidAliasMap } from './rosterAlias.js';

/** Anonymize a run's raw (uncompressed) sub-log bytes given its roster. Returns name-free bytes ready
 *  to gzip + upload. A roster with no players returns the input unchanged. */
export function anonymizeRunLog(raw: Uint8Array, roster: RosterEntry[]): Uint8Array {
  return anonymizeLog(raw, guidAliasMap(roster));
}
