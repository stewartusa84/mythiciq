// Anonymize a combat log's player names: replace the quoted display name that follows each known
// Player- GUID with a supplied alias, leaving everything else (GUIDs, flags, spell/creature names,
// numeric fields, field shape) byte-for-byte intact. Pure + lossless — exactly one quoted token is
// swapped for another per occurrence, so the anonymized log parses identically to the original (same
// event count, same per-line field count).
//
// In a combat log a player's display NAME appears only in the unit block, immediately after its GUID:
//   Player-1-0000001,"Tankadin",0x511,0x0
// Advanced-block GUIDs (infoGuid / ownerGuid) are followed by numeric fields, never a quoted token, so
// anchoring on the `Player-…,"…"` position never touches them. Spell names ("Tiger Palm"), creature
// names ("Risen Ghoul" — preceded by a Creature- GUID), and COMBATANT_INFO (a GUID with no name) are
// all left alone for the same reason.
//
// The aliases MUST be free of `"` and `,` so the field count can't change — the app's role aliases
// (Tank / Healer / DPS 1 …) satisfy this. Used by the share pipeline to publish a name-free sub-log.

const enc = new TextEncoder();
const dec = new TextDecoder();

// A Player GUID immediately followed by a quoted name token. The GUID body is digits / hex / hyphens
// (e.g. Player-1-0000001, Player-<region>-<serverHex>); it stops at the comma before the quote.
const PLAYER_NAME = /(Player-[0-9A-Fa-f-]+),"[^"]*"/g;

/**
 * Rewrite `raw` so every player name that follows a GUID present in `aliasByGuid` becomes that GUID's
 * alias. GUIDs not in the map are left untouched (e.g. a stray non-party player). Returns the original
 * bytes unchanged when the map is empty.
 */
export function anonymizeLog(raw: Uint8Array, aliasByGuid: Map<string, string>): Uint8Array {
  if (aliasByGuid.size === 0) return raw;
  const text = dec.decode(raw);
  const out = text.replace(PLAYER_NAME, (match, guid: string) => {
    const alias = aliasByGuid.get(guid);
    return alias === undefined ? match : `${guid},"${alias}"`;
  });
  return enc.encode(out);
}
