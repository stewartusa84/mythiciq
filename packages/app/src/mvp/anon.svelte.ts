// Anonymize / streaming-privacy state. A global toggle that maps each player's real name to a stable
// role-based alias (Tank / Healer / DPS 1…), so a streamer can review a log without exposing names.
// Runes in a `.svelte.ts` module → reactive across components. Only player NAMES are masked; class /
// spec visuals stay (class isn't personally identifying), and non-roster strings pass through unchanged.
import type { RosterEntry } from '@wow/engine';
import { nameAliasMap } from './rosterAlias.js';

class AnonState {
  enabled = $state(false);
  aliasByName = $state(new Map<string, string>());

  setRoster(roster: RosterEntry[]): void {
    this.aliasByName = nameAliasMap(roster);
  }
  toggle(): void {
    this.enabled = !this.enabled;
  }
  /** Mask a unit display name when anonymizing; pass through otherwise / for non-players. */
  name(n: string | undefined | null): string {
    if (!n) return n ?? '';
    if (!this.enabled) return n;
    return this.aliasByName.get(n) ?? n;
  }
}

export const anon = new AnonState();
