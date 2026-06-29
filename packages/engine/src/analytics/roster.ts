// Player roster for the run — every Player- actor with a resolvable name, tagged with its group role
// (from COMBATANT_INFO specId). Shipped in the report so the UI can build a name→alias map for the
// "anonymize" / streaming-privacy toggle (replace names with Tank / Healer / DPS 1…), available the
// moment the report arrives (not waiting for the lazy replay model).

import type { ColumnStore } from '../columns/columnStore.js';
import { roleOf, type PlayerRole } from '../spells/specIds.js';

export interface RosterEntry {
  guid: string;
  name: string;
  /** group role from COMBATANT_INFO specId; undefined when the player had no COMBATANT_INFO. */
  role?: PlayerRole;
  /** raw COMBATANT_INFO specId (for class color / spec icon); undefined when absent. */
  specId?: number;
}

/**
 * Roster of players. With no `range`, that's every named Player- actor in the whole log (the anonymize
 * name→alias map needs all of them). With a `range` (a single dungeon run's event window), it's scoped
 * to that run's PARTY — the players who emitted COMBATANT_INFO inside the run — so per-run panels don't
 * mix in players from other keys in a multi-run log (a multi-key file would otherwise blend rosters).
 */
export function buildRoster(store: ColumnStore, range?: { start: number; end: number }): RosterEntry[] {
  const start = range ? Math.max(0, range.start) : 0;
  const end = range ? Math.min(store.count, range.end) : store.count;

  // specId (⇒ role) per player from COMBATANT_INFO (guid string -> specId), and — when scoping to a run
  // — the set of guids that had a COMBATANT_INFO in range (the run's participants; emitted at run start).
  const specByGuid = new Map<string, number>();
  const participants = new Set<string>();
  const ciId = store.eventTypeId('COMBATANT_INFO');
  if (ciId !== undefined) {
    for (let i = start; i < end; i++) {
      if (store.eventType[i] !== ciId) continue;
      const guid = store.detail(i, 'playerGuid');
      if (typeof guid !== 'string') continue;
      participants.add(guid);
      const specId = store.detailNumber(i, 'specId');
      if (specId !== undefined) specByGuid.set(guid, specId);
    }
  }
  // Only filter by participants when scoping to a run AND we actually found COMBATANT_INFO in it;
  // otherwise (whole-log, or a run with no COMBATANT_INFO) fall back to all named players.
  const scoped = range !== undefined && participants.size > 0;

  const out: RosterEntry[] = [];
  for (const id of store.actorIds()) {
    if (!store.isPlayer(id)) continue;
    const name = store.actorName(id);
    if (!name) continue;
    const guid = store.str(id);
    if (scoped && !participants.has(guid)) continue;
    const specId = specByGuid.get(guid);
    const role = roleOf(specId);
    out.push({ guid, name, ...(role ? { role } : {}), ...(specId !== undefined ? { specId } : {}) });
  }
  return out;
}
