// Deterministic role-based player aliases (Tank / Healer / DPS 1 …) for a run's roster. This is the
// SINGLE source of truth for the alias scheme, shared by two consumers so they can never drift:
//   - the anonymize display toggle (anon.svelte.ts) — masks names in the UI (name → alias), and
//   - the share anonymizer (anonymizeLog.ts) — rewrites the uploaded sub-log (guid → alias).
// Because both derive from this, a comment referencing "DPS 3" on a shared run points at the same
// player the replay shows as "DPS 3".
import type { RosterEntry, PlayerRole } from '@wow/engine';

const ROLE_LABEL: Record<string, string> = { tank: 'Tank', healer: 'Healer', dps: 'DPS', other: 'Player' };

export interface AliasEntry {
  guid: string;
  name: string;
  alias: string;
}

/** Assign each player an alias, numbered within its role. Sorted by name within a role so the numbering
 *  is stable across reloads. A lone tank/healer needs no number; dps (and any 'other') are numbered. */
export function aliasEntries(roster: RosterEntry[]): AliasEntry[] {
  const byRole = new Map<string, RosterEntry[]>();
  for (const r of roster) {
    const key: string = (r.role as PlayerRole | undefined) ?? 'other';
    (byRole.get(key) ?? byRole.set(key, []).get(key)!).push(r);
  }
  const out: AliasEntry[] = [];
  for (const [role, list] of byRole) {
    list.sort((a, b) => a.name.localeCompare(b.name));
    const numbered = list.length > 1 || role === 'dps' || role === 'other';
    list.forEach((r, i) =>
      out.push({ guid: r.guid, name: r.name, alias: numbered ? `${ROLE_LABEL[role]} ${i + 1}` : ROLE_LABEL[role]! }),
    );
  }
  return out;
}

/** name → alias (the anonymize toggle masks display names by exact roster-name match). */
export function nameAliasMap(roster: RosterEntry[]): Map<string, string> {
  return new Map(aliasEntries(roster).map((e) => [e.name, e.alias]));
}

/** guid → alias (the share anonymizer rewrites the `Player-…,"name"` token by GUID). */
export function guidAliasMap(roster: RosterEntry[]): Map<string, string> {
  return new Map(aliasEntries(roster).map((e) => [e.guid, e.alias]));
}
