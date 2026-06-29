// Per-player COMBATANT_INFO extraction: spec, secondary-stat ratings, talents, equipped gear,
// and combat-start auras. One COMBATANT_INFO row is emitted per party member at run start, so
// this is rare-event work (no hot path). The Rust parser ships the talents/gear/auras blobs as
// raw strings (the CSV tokenizer keeps each `[...]`/`(...)` intact); we parse the nested Lua-ish
// structure here.
//
// This is the DATA foundation for "which talents modify which abilities" — resolving talent
// entryIds to abilities (DB2 trait tables) and consuming gear/talents in analytics is follow-on.

import type { ColumnStore } from '../columns/columnStore.js';

/** One talent tree selection: a chosen entry on a trait node, with the points spent (rank). */
export interface TalentEntry {
  nodeId: number;
  entryId: number;
  rank: number;
}

/** One equipped item. Empty slots (itemId 0) are dropped. */
export interface GearItem {
  /** 0-based position in the COMBATANT_INFO gear array = equipment slot (3=shirt, 15=mainhand,
   *  16=offhand, 17=tabard). Kept so the ilvl average can exclude the cosmetic shirt/tabard slots. */
  slot: number;
  itemId: number;
  itemLevel: number;
  /** permanent/temp enchant ids on the item (often empty) */
  enchantIds: number[];
  /** itemBonus ids (warforge/socket/tier tokens etc.) */
  bonusIds: number[];
  /** socketed gem ids (flattened; the game lists gemId,gemLevel pairs) */
  gemIds: number[];
}

/** A buff/debuff already active on a unit when the run started. */
export interface CombatantAura {
  sourceGuid: string;
  spellId: number;
}

export interface CombatantStats {
  primary: number;
  stamina: number;
  crit: number;
  haste: number;
  mastery: number;
  versatility: number;
  speed: number;
  leech: number;
  avoidance: number;
  armor: number;
}

export interface CombatantInfo {
  guid: string;
  specId?: number;
  stats: CombatantStats;
  /** average item level across equipped (non-empty) gear slots; 0 when no gear parsed. */
  itemLevel: number;
  talents: TalentEntry[];
  gear: GearItem[];
  auras: CombatantAura[];
}

// ---------------------------------------------------------------------------
// Nested-structure parser for the `[...]` / `(...)` blobs.
// ---------------------------------------------------------------------------

type Node = number | string | Node[];

/** Parse one WoW COMBATANT_INFO structure blob (e.g. talents/gear) into a nested array tree. */
function parseStructure(raw: string | undefined): Node[] {
  if (!raw) return [];
  const s = raw.trim();
  if (!s) return [];
  let i = 0;

  function scalar(t: string): Node {
    const trimmed = t.trim();
    // item/spell/node ids and ranks are integers; GUIDs (Player-…/Creature-…) stay strings.
    if (/^-?\d+$/.test(trimmed)) {
      const n = Number(trimmed);
      if (Number.isSafeInteger(n)) return n;
    }
    return trimmed;
  }

  function parseGroup(close: string): Node[] {
    i++; // skip the opening bracket/paren
    const items: Node[] = [];
    let token = '';
    const flush = () => {
      if (token.trim().length) items.push(scalar(token));
      token = '';
    };
    while (i < s.length) {
      const c = s[i]!;
      if (c === close) {
        i++;
        flush();
        return items;
      }
      if (c === '(') {
        flush();
        items.push(parseGroup(')'));
        continue;
      }
      if (c === '[') {
        flush();
        items.push(parseGroup(']'));
        continue;
      }
      if (c === ',') {
        flush();
        i++;
        continue;
      }
      token += c;
      i++;
    }
    flush();
    return items;
  }

  const first = s[0];
  if (first === '[') return parseGroup(']');
  if (first === '(') return parseGroup(')');
  return [];
}

function asNum(n: Node | undefined): number {
  return typeof n === 'number' ? n : 0;
}
function numList(n: Node | undefined): number[] {
  return Array.isArray(n) ? n.filter((x): x is number => typeof x === 'number') : [];
}

// ---------------------------------------------------------------------------
// Per-field parsers (exported for tests + reuse).
// ---------------------------------------------------------------------------

/** Talents blob `[(nodeId,entryId,rank),…]` → entries. */
export function parseTalents(raw: string | undefined): TalentEntry[] {
  return parseStructure(raw)
    .filter((e): e is Node[] => Array.isArray(e))
    .map((e) => ({ nodeId: asNum(e[0]), entryId: asNum(e[1]), rank: asNum(e[2]) }));
}

// Equipment-slot positions in the COMBATANT_INFO gear array. Shirt + tabard are cosmetic and the
// game excludes them from the average ilvl; mainhand/offhand drive the 2H double-count rule below.
const SHIRT_SLOT = 3;
const MAINHAND_SLOT = 15;
const OFFHAND_SLOT = 16;
const TABARD_SLOT = 17;

/** Gear blob `[(itemId,ilvl,(enchants),(bonusIds),(gems)),…]` → items (empty slots dropped). The
 *  array is positional by equipment slot, so we record `slot` (the pre-filter index) before dropping
 *  empties — the ilvl average needs it to exclude the cosmetic shirt/tabard slots. */
export function parseGear(raw: string | undefined): GearItem[] {
  return parseStructure(raw)
    .map((e, slot) => ({ e, slot }))
    .filter((x): x is { e: Node[]; slot: number } => Array.isArray(x.e))
    .map(({ e, slot }) => ({
      slot,
      itemId: asNum(e[0]),
      itemLevel: asNum(e[1]),
      enchantIds: numList(e[2]).filter((x) => x !== 0),
      bonusIds: numList(e[3]),
      gemIds: numList(e[4]),
    }))
    .filter((it) => it.itemId !== 0);
}

/**
 * Character-sheet item level from the equipped gear. Matches the in-game calc: average across
 * equipment slots EXCLUDING the cosmetic shirt + tabard (which log as ilvl 1 / 0 and otherwise drag
 * the average down by ~15), and counting a two-handed weapon twice (an empty off-hand slot beside a
 * filled main-hand ⇒ the main-hand fills the off-hand for ilvl purposes). 0 when no gear parsed.
 */
export function computeItemLevel(gear: GearItem[]): number {
  const counted: number[] = [];
  let mainhand: GearItem | undefined;
  let hasOffhand = false;
  for (const g of gear) {
    if (g.slot === MAINHAND_SLOT) mainhand = g;
    if (g.slot === OFFHAND_SLOT) hasOffhand = true;
    if (g.slot === SHIRT_SLOT || g.slot === TABARD_SLOT) continue; // cosmetic — not counted
    if (g.itemLevel > 0) counted.push(g.itemLevel);
  }
  // Two-hander: empty off-hand beside a filled main-hand counts the main-hand twice.
  if (mainhand && !hasOffhand && mainhand.itemLevel > 0) counted.push(mainhand.itemLevel);
  if (!counted.length) return 0;
  return Math.round(counted.reduce((a, b) => a + b, 0) / counted.length);
}

/** Combat-start auras blob `[guid,spellId,count, …]` (flat triples) → {sourceGuid, spellId}. */
export function parseAuras(raw: string | undefined): CombatantAura[] {
  const flat = parseStructure(raw);
  const out: CombatantAura[] = [];
  for (let k = 0; k + 1 < flat.length; k += 3) {
    const guid = flat[k];
    const spellId = flat[k + 1];
    if (typeof guid === 'string' && typeof spellId === 'number') {
      out.push({ sourceGuid: guid, spellId });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Builder.
// ---------------------------------------------------------------------------

function str(store: ColumnStore, i: number, name: string): string | undefined {
  const v = store.detail(i, name);
  return typeof v === 'string' ? v : undefined;
}

/**
 * Combatants in the event window. With no `range` that's every COMBATANT_INFO in the log;
 * with a run's `range` it's that run's party (COMBATANT_INFO is emitted at run start). Mirrors
 * `buildRoster`'s scoping. Dedupes by guid (latest in range wins) — a re-rolled key can emit a
 * second COMBATANT_INFO for the same player.
 */
export function buildCombatants(
  store: ColumnStore,
  range?: { start: number; end: number },
): CombatantInfo[] {
  const start = range ? Math.max(0, range.start) : 0;
  const end = range ? Math.min(store.count, range.end) : store.count;
  const ciId = store.eventTypeId('COMBATANT_INFO');
  if (ciId === undefined) return [];

  const byGuid = new Map<string, CombatantInfo>();
  for (let i = start; i < end; i++) {
    if (store.eventType[i] !== ciId) continue;
    const guid = str(store, i, 'playerGuid');
    if (!guid) continue;

    const gear = parseGear(str(store, i, 'gear'));
    const itemLevel = computeItemLevel(gear);
    const specId = store.detailNumber(i, 'specId');

    byGuid.set(guid, {
      guid,
      ...(specId !== undefined ? { specId } : {}),
      stats: {
        primary: store.detailNumber(i, 'primaryStat') ?? 0,
        stamina: store.detailNumber(i, 'stamina') ?? 0,
        crit: store.detailNumber(i, 'critRating') ?? 0,
        haste: store.detailNumber(i, 'hasteRating') ?? 0,
        mastery: store.detailNumber(i, 'masteryRating') ?? 0,
        versatility: store.detailNumber(i, 'versatilityRating') ?? 0,
        speed: store.detailNumber(i, 'speedRating') ?? 0,
        leech: store.detailNumber(i, 'leechRating') ?? 0,
        avoidance: store.detailNumber(i, 'avoidanceRating') ?? 0,
        armor: store.detailNumber(i, 'armor') ?? 0,
      },
      itemLevel,
      talents: parseTalents(str(store, i, 'talents')),
      gear,
      auras: parseAuras(str(store, i, 'combatantAuras')),
    });
  }
  return [...byGuid.values()];
}
