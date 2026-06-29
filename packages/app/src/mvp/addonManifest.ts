// Addon manifest export — the string a user pastes into the MythicIQ WoW addon (AddOns/MythicIQ).
// The addon parses this to bridge a MythicIQ group into the in-game Premade Group Finder:
//   * Leader manifest  → addon shows a copyable listing name + a live roster of who has applied/joined.
//   * Apply manifest   → addon opens the Group Finder and pre-fills the search box with the group name.
//
// Format (pipe-delimited, percent-encoded values) — MUST stay in sync with the addon's ParseManifest:
//   MIQ1|MODE=LEADER|CODE=37DF1Q|NAME=MythicIQ%2037DF1Q|P1=Name-Realm|P2=Name-Realm
//   MIQ1|MODE=APPLY|CODE=37DF1Q|NAME=MythicIQ%2037DF1Q|ROLE=DAMAGER
//
// Encode reserved chars the addon's UrlDecode reverses: % | = , and space. `%` MUST be replaced first.

import type { RunCard, RosterEntry, LfgRole } from './lfg.js';

/** Percent-encode a value so the addon's UrlDecode round-trips it. Order matters: `%` first. */
function enc(value: string): string {
  return value
    .replace(/%/g, '%25')
    .replace(/\|/g, '%7C')
    .replace(/=/g, '%3D')
    .replace(/,/g, '%2C')
    .replace(/ /g, '%20');
}

/** A stable, short, human-typeable code derived from the Run Card id, so the LEADER and every applicant
 *  independently produce the SAME code for one run (it's the listing-title key everyone searches). 6 chars
 *  of base36 (0-9A-Z), like "37DF1Q". FNV-1a over the card id; collisions across the handful of live cards
 *  are vanishingly unlikely and harmless (two listings would just share a search name). */
export function groupCodeFor(card: { id: string }): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < card.id.length; i++) {
    h ^= card.id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36).toUpperCase().padStart(6, '0').slice(-6);
}

/** The listing name the leader pastes into the WoW listing title and applicants search for. */
export function groupNameFor(card: { id: string }): string {
  return `MythicIQ ${groupCodeFor(card)}`;
}

/** Map an LFG role to the WoW role token the addon understands. */
function wowRole(role: LfgRole): string {
  switch (role) {
    case 'tank': return 'TANK';
    case 'healer': return 'HEALER';
    default: return 'DAMAGER'; // dps + coach
  }
}

function nameRealm(m: RosterEntry): string {
  return `${m.character.name}-${m.character.realm}`;
}

/** Build the LEADER manifest: the group code + the expected players (the accepted roster, minus the leader
 *  themselves — they're already in their own group). The addon tracks each through Awaiting→Applied→Joined. */
export function leaderManifest(card: RunCard, ownerSub: string): string {
  const code = groupCodeFor(card);
  const name = groupNameFor(card);
  const expected = card.roster.filter((m) => m.sub !== ownerSub);
  const parts = [
    'MIQ1',
    'MODE=LEADER',
    `CODE=${enc(code)}`,
    `NAME=${enc(name)}`,
    ...expected.map((m, i) => `P${i + 1}=${enc(nameRealm(m))}`),
  ];
  return parts.join('|');
}

/** Build the APPLY manifest for one rostered member: the group code to search for + their role. */
export function applyManifest(card: RunCard, role: LfgRole): string {
  const code = groupCodeFor(card);
  const name = groupNameFor(card);
  return ['MIQ1', 'MODE=APPLY', `CODE=${enc(code)}`, `NAME=${enc(name)}`, `ROLE=${role ? wowRole(role) : 'DAMAGER'}`].join('|');
}
