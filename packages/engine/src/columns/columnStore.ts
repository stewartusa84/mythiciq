import type { ParserWasmExports } from '../wasm/loader.js';
import { SideKind, I64_NULL, I32_NULL } from './schema.js';
import { decodeUnitFlags, decodeRaidMarkers, decodeSpellSchools, type UnitFlags } from './decode.js';

const decoder = new TextDecoder('utf-8');

export type SideValue = number | string | boolean | number[] | null;

/** A single event with every column decoded — for the dev inspector / diagnostics. */
export interface DecodedUnit {
  guid: string;
  name: string;
  flags: number | null;
  flagsDecoded: UnitFlags | null;
  raidFlags: number | null;
  raidMarkers: string[];
}
export interface DecodedEvent {
  index: number;
  tsMs: number;
  eventType: string;
  recordKind: number;
  format: number;
  source: DecodedUnit;
  target: DecodedUnit;
  spell: { id: number | null; name: string; school: number | null; schools: string[] };
  amount: number;
  details: Record<string, SideValue>;
}

/**
 * Zero-copy view over the columnar event store in WASM linear memory.
 *
 * Hot columns are typed-array views directly onto the WASM buffer (no copy). They stay
 * valid as long as WASM memory does not grow — which it doesn't after a parse. The
 * `amount` column is `f64` so it's a plain `Float64Array`; the `*_flags`/`*_school`
 * and side `ival` columns are `i64` (`BigInt64Array`) and read via helpers that map the
 * null sentinel to `null`.
 */
export class ColumnStore {
  readonly count: number;

  // hot columns (zero-copy)
  readonly ts: Float64Array;
  readonly eventType: Uint32Array;
  readonly recordKind: Uint8Array;
  readonly formatId: Uint8Array;
  readonly sourceGuid: Uint32Array;
  readonly sourceName: Uint32Array;
  readonly sourceFlags: BigInt64Array;
  readonly sourceRaid: BigInt64Array;
  readonly targetGuid: Uint32Array;
  readonly targetName: Uint32Array;
  readonly targetFlags: BigInt64Array;
  readonly targetRaid: BigInt64Array;
  readonly spellId: Int32Array;
  readonly spellNameId: Uint32Array;
  readonly spellSchool: BigInt64Array;
  readonly amount: Float64Array;

  // side table (zero-copy)
  private readonly sideOffsets: Uint32Array;
  private readonly sideName: Uint32Array;
  private readonly sideKind: Uint8Array;
  private readonly sideIval: BigInt64Array;
  private readonly sideFval: Float64Array;

  // intern table + lazy decode cache
  private readonly internBytes: Uint8Array;
  private readonly internOffsets: Uint32Array;
  private readonly stringCache: (string | undefined)[];

  // side maps
  private readonly actorNameById = new Map<number, number>();
  private readonly spellNameById = new Map<number, number>();
  private readonly eventTypeNameById = new Map<number, string>();
  private readonly eventTypeIdByName = new Map<string, number>();

  constructor(wasm: ParserWasmExports) {
    const buf = wasm.memory.buffer;
    const n = wasm.event_count();
    this.count = n;

    this.ts = new Float64Array(buf, wasm.col_ts_ptr(), n);
    this.eventType = new Uint32Array(buf, wasm.col_event_type_ptr(), n);
    this.recordKind = new Uint8Array(buf, wasm.col_record_kind_ptr(), n);
    this.formatId = new Uint8Array(buf, wasm.col_format_ptr(), n);
    this.sourceGuid = new Uint32Array(buf, wasm.col_source_guid_ptr(), n);
    this.sourceName = new Uint32Array(buf, wasm.col_source_name_ptr(), n);
    this.sourceFlags = new BigInt64Array(buf, wasm.col_source_flags_ptr(), n);
    this.sourceRaid = new BigInt64Array(buf, wasm.col_source_raid_ptr(), n);
    this.targetGuid = new Uint32Array(buf, wasm.col_target_guid_ptr(), n);
    this.targetName = new Uint32Array(buf, wasm.col_target_name_ptr(), n);
    this.targetFlags = new BigInt64Array(buf, wasm.col_target_flags_ptr(), n);
    this.targetRaid = new BigInt64Array(buf, wasm.col_target_raid_ptr(), n);
    this.spellId = new Int32Array(buf, wasm.col_spell_id_ptr(), n);
    this.spellNameId = new Uint32Array(buf, wasm.col_spell_name_ptr(), n);
    this.spellSchool = new BigInt64Array(buf, wasm.col_spell_school_ptr(), n);
    this.amount = new Float64Array(buf, wasm.col_amount_ptr(), n);

    const sideLen = wasm.side_len();
    this.sideOffsets = new Uint32Array(buf, wasm.side_offsets_ptr(), n + 1);
    this.sideName = new Uint32Array(buf, wasm.side_name_ptr(), sideLen);
    this.sideKind = new Uint8Array(buf, wasm.side_kind_ptr(), sideLen);
    this.sideIval = new BigInt64Array(buf, wasm.side_ival_ptr(), sideLen);
    this.sideFval = new Float64Array(buf, wasm.side_fval_ptr(), sideLen);

    const internCount = wasm.intern_count();
    this.internBytes = new Uint8Array(buf, wasm.intern_bytes_ptr(), wasm.intern_bytes_len());
    this.internOffsets = new Uint32Array(buf, wasm.intern_offsets_ptr(), internCount + 1);
    this.stringCache = new Array(internCount);

    const actorCount = wasm.actor_count();
    const actorGuid = new Uint32Array(buf, wasm.actor_guid_ptr(), actorCount);
    const actorName = new Uint32Array(buf, wasm.actor_name_ptr(), actorCount);
    for (let i = 0; i < actorCount; i++) this.actorNameById.set(actorGuid[i]!, actorName[i]!);

    const spellCount = wasm.spell_count();
    const spellIds = new Int32Array(buf, wasm.spell_id_ptr(), spellCount);
    const spellNames = new Uint32Array(buf, wasm.spell_name_ptr(), spellCount);
    for (let i = 0; i < spellCount; i++) this.spellNameById.set(spellIds[i]!, spellNames[i]!);

    // Build the event-type name<->id maps with a single pass over the column.
    for (let i = 0; i < n; i++) {
      const id = this.eventType[i]!;
      if (id !== 0 && !this.eventTypeNameById.has(id)) {
        const name = this.str(id);
        this.eventTypeNameById.set(id, name);
        this.eventTypeIdByName.set(name, id);
      }
    }
  }

  /** Resolve an interned string id to its UTF-8 string (decoded lazily, cached). */
  str(id: number): string {
    const cached = this.stringCache[id];
    if (cached !== undefined) return cached;
    const start = this.internOffsets[id]!;
    const end = this.internOffsets[id + 1]!;
    const s = decoder.decode(this.internBytes.subarray(start, end));
    this.stringCache[id] = s;
    return s;
  }

  /** Actor display name for an interned GUID id (0 -> ''). */
  actorName(guidId: number): string {
    if (guidId === 0) return '';
    const nameId = this.actorNameById.get(guidId);
    return nameId === undefined ? '' : this.str(nameId);
  }

  /** Spell name for a numeric WoW spell id, or '' if unseen. */
  spellName(spellId: number): string {
    const nameId = this.spellNameById.get(spellId);
    return nameId === undefined ? '' : this.str(nameId);
  }

  /** Event-type name for a row's interned event-type id. */
  eventTypeName(id: number): string {
    return this.eventTypeNameById.get(id) ?? '';
  }

  /** Interned id for an event-type name, or undefined if it never appears in the log. */
  eventTypeId(name: string): number | undefined {
    return this.eventTypeIdByName.get(name);
  }

  /** Set of interned ids for the given event-type names that occur in this log. */
  eventTypeIds(names: readonly string[]): Set<number> {
    const out = new Set<number>();
    for (const name of names) {
      const id = this.eventTypeIdByName.get(name);
      if (id !== undefined) out.add(id);
    }
    return out;
  }

  /** Distinct actor ids seen with a name (the resolvable roster). */
  actorIds(): number[] {
    return [...this.actorNameById.keys()];
  }

  // ---- i64 column helpers (null sentinel -> null) ----
  private static i64(v: bigint): number | null {
    return v === I64_NULL ? null : Number(v);
  }
  sourceFlagsNum(i: number): number | null {
    return ColumnStore.i64(this.sourceFlags[i]!);
  }
  targetFlagsNum(i: number): number | null {
    return ColumnStore.i64(this.targetFlags[i]!);
  }
  spellSchoolNum(i: number): number | null {
    return ColumnStore.i64(this.spellSchool[i]!);
  }
  spellIdNum(i: number): number | null {
    const v = this.spellId[i]!;
    return v === I32_NULL ? null : v;
  }

  // ---- side table ----
  /** All long-tail detail fields for event `i` as a plain object. */
  details(i: number): Record<string, SideValue> {
    const out: Record<string, SideValue> = {};
    const start = this.sideOffsets[i]!;
    const end = this.sideOffsets[i + 1]!;
    for (let k = start; k < end; k++) {
      out[this.str(this.sideName[k]!)] = this.sideValue(k);
    }
    return out;
  }

  /** Look up a single detail field by name for event `i` (undefined if absent). */
  detail(i: number, name: string): SideValue | undefined {
    const start = this.sideOffsets[i]!;
    const end = this.sideOffsets[i + 1]!;
    for (let k = start; k < end; k++) {
      if (this.str(this.sideName[k]!) === name) return this.sideValue(k);
    }
    return undefined;
  }

  private sideValue(k: number): SideValue {
    switch (this.sideKind[k]) {
      case SideKind.NULL:
        return null;
      case SideKind.INT:
        return Number(this.sideIval[k]!);
      case SideKind.FLOAT:
        return this.sideFval[k]!;
      case SideKind.BOOL:
        return this.sideIval[k]! !== 0n;
      case SideKind.STRING:
        return this.str(Number(this.sideIval[k]!));
      case SideKind.INT_ARRAY:
        return parseIntArray(this.str(Number(this.sideIval[k]!)));
      default:
        return null;
    }
  }

  /** Numeric detail (INT/FLOAT) for event `i`, or undefined if absent/non-numeric. */
  detailNumber(i: number, name: string): number | undefined {
    const v = this.detail(i, name);
    return typeof v === 'number' ? v : undefined;
  }

  /**
   * Extract the advanced-block unit snapshot for event `i` in a single pass over its
   * side run: the interned unit id (from `infoGuid` — the same id space as the
   * source/target GUID columns), plus `currentHp`/`maxHp`. Returns undefined unless
   * all three are present and `maxHp > 0`.
   */
  advancedSnapshot(i: number): { unitId: number; currentHp: number; maxHp: number } | undefined {
    const start = this.sideOffsets[i]!;
    const end = this.sideOffsets[i + 1]!;
    let unitId = 0;
    let currentHp = -1;
    let maxHp = -1;
    for (let k = start; k < end; k++) {
      const name = this.str(this.sideName[k]!);
      if (name === 'infoGuid') {
        if (this.sideKind[k] === SideKind.STRING) unitId = Number(this.sideIval[k]!);
      } else if (name === 'currentHp') {
        if (this.sideKind[k] === SideKind.INT) currentHp = Number(this.sideIval[k]!);
      } else if (name === 'maxHp') {
        if (this.sideKind[k] === SideKind.INT) maxHp = Number(this.sideIval[k]!);
      }
    }
    if (unitId <= 0 || currentHp < 0 || maxHp <= 0) return undefined;
    return { unitId, currentHp, maxHp };
  }

  /**
   * Advanced-block POWER snapshot for event `i`: the unit (`infoGuid`) plus its `powerType`
   * and `currentPower` at that moment. The combat log samples power only on the unit's own
   * advanced events (its casts/damage), so this is the basis for a hold-last power timeline.
   * Returns undefined unless a unit + a numeric powerType + currentPower are all present.
   */
  powerSnapshot(i: number): { unitId: number; powerType: number; currentPower: number; maxPower: number } | undefined {
    const start = this.sideOffsets[i]!;
    const end = this.sideOffsets[i + 1]!;
    let unitId = 0;
    let powerType = -1;
    let currentPower = -1;
    let maxPower = -1;
    for (let k = start; k < end; k++) {
      const name = this.str(this.sideName[k]!);
      // Take the FIRST occurrence of each field — the advanced block is stored before any suffix
      // (ENERGIZE/DRAIN/LEECH), so first-wins gives the current resource state from the advanced
      // block rather than the "what was drained/energized" info from the suffix. Last-wins caused
      // a mismatch: suffix powerType=5 (Runes drained) + advanced-block currentPower=550 (RP) → 550/6.
      if (name === 'infoGuid') {
        if (unitId === 0 && this.sideKind[k] === SideKind.STRING) unitId = Number(this.sideIval[k]!);
      } else if (name === 'powerType') {
        if (powerType < 0 && this.sideKind[k] === SideKind.INT) powerType = Number(this.sideIval[k]!);
      } else if (name === 'currentPower') {
        if (currentPower < 0 && this.sideKind[k] === SideKind.INT) currentPower = Number(this.sideIval[k]!);
      } else if (name === 'maxPower') {
        if (maxPower < 0 && this.sideKind[k] === SideKind.INT) maxPower = Number(this.sideIval[k]!);
      }
    }
    if (unitId <= 0 || powerType < 0 || currentPower < 0) return undefined;
    return { unitId, powerType, currentPower, maxPower: maxPower >= 0 ? maxPower : currentPower };
  }

  /** True if an interned unit id is a player (GUID begins "Player-"). */
  isPlayer(unitId: number): boolean {
    return unitId !== 0 && this.str(unitId).startsWith('Player-');
  }

  private _petOwners: Map<number, number> | null = null;
  /** Pet/guardian GUID id → owner GUID id, memoized on first use. Two signals, advanced-block first:
   *  1. AUTHORITATIVE — the `ownerGuid` the game stamps on a unit's OWN spell damage/heal/cast events
   *     (where the advanced `infoGuid` == the source). Present on every such event, so it works even
   *     for a pet that was already out before the log started. `ownerGuid` is stored as a STRING detail
   *     whose value is the OWNER's interned id (same id space as the GUID columns) — usable directly.
   *  2. FALLBACK — SPELL_SUMMON (source = summoner, dest = pet), for a pet that only ever melees (its
   *     SWING advanced block describes the TARGET, not itself) and so never stamps a source ownerGuid. */
  private petOwners(): Map<number, number> {
    if (this._petOwners) return this._petOwners;
    const m = new Map<number, number>();
    const noOwner = new Set<number>(); // sources the game has confirmed have no owner (stop re-checking)
    // Spell damage/heal/cast events have a source-describing advanced block (infoGuid == source); SWING_*
    // does NOT (its infoGuid is the target), so it's excluded by listing only the SPELL_/RANGE_ types.
    const advSrc = this.eventTypeIds([
      'SPELL_DAMAGE', 'SPELL_PERIODIC_DAMAGE', 'RANGE_DAMAGE', 'SPELL_HEAL', 'SPELL_PERIODIC_HEAL', 'SPELL_CAST_SUCCESS',
    ]);
    for (let i = 0; i < this.count; i++) {
      if (!advSrc.has(this.eventType[i]!)) continue;
      const src = this.sourceGuid[i]!;
      if (src === 0 || m.has(src) || noOwner.has(src) || this.isPlayer(src)) continue;
      const start = this.sideOffsets[i]!;
      const end = this.sideOffsets[i + 1]!;
      let owner = -1;
      for (let k = start; k < end; k++) {
        if (this.sideKind[k] === SideKind.STRING && this.str(this.sideName[k]!) === 'ownerGuid') {
          owner = Number(this.sideIval[k]!);
          break; // advanced block's ownerGuid is the first/only one
        }
      }
      if (owner < 0) continue; // no advanced owner field on this event — try a later one for this source
      const os = owner > 0 ? this.str(owner) : '';
      if (os && !os.startsWith('0000') && owner !== src) m.set(src, owner);
      else noOwner.add(src); // game says this source has no owner (enemy/independent) → stop checking it
    }
    // Fallback: SPELL_SUMMON for any pet not already resolved by an advanced ownerGuid.
    const summonId = this.eventTypeId('SPELL_SUMMON');
    if (summonId !== undefined) {
      for (let i = 0; i < this.count; i++) {
        if (this.eventType[i] !== summonId) continue;
        const owner = this.sourceGuid[i]!;
        const pet = this.targetGuid[i]!;
        if (owner !== 0 && pet !== 0 && pet !== owner && !m.has(pet)) m.set(pet, owner);
      }
    }
    this._petOwners = m;
    return m;
  }

  /** Resolve a source GUID to the actor that ultimately controls it: follows pet→owner links so a
   *  pet's damage/healing attributes to its owner — fixing low DPS for pet-heavy specs (Demo Lock,
   *  BM Hunter, Unholy DK, …). Returns the input id when it isn't an owned pet. The advanced-block
   *  ownerGuid signal (see `petOwners`) handles pets that were already out before the log started. */
  ownerOf(guidId: number): number {
    const m = this.petOwners();
    let g = guidId;
    for (let hops = 0; hops < 4 && m.has(g); hops++) g = m.get(g)!; // follow pet-of-pet chains, guarded
    return g;
  }

  private decodeUnit(guidId: number, nameId: number, flags: number | null, raid: number | null): DecodedUnit {
    return {
      guid: guidId === 0 ? '' : this.str(guidId),
      name: nameId === 0 ? '' : this.str(nameId),
      flags,
      flagsDecoded: decodeUnitFlags(flags),
      raidFlags: raid,
      raidMarkers: decodeRaidMarkers(raid),
    };
  }

  /** Decode every column + side detail for event `i` into a plain object. */
  decodeEvent(i: number): DecodedEvent {
    const school = this.spellSchoolNum(i);
    return {
      index: i,
      tsMs: this.ts[i]!,
      eventType: this.eventTypeName(this.eventType[i]!),
      recordKind: this.recordKind[i]!,
      format: this.formatId[i]!,
      source: this.decodeUnit(this.sourceGuid[i]!, this.sourceName[i]!, this.sourceFlagsNum(i), ColumnStore.i64(this.sourceRaid[i]!)),
      target: this.decodeUnit(this.targetGuid[i]!, this.targetName[i]!, this.targetFlagsNum(i), ColumnStore.i64(this.targetRaid[i]!)),
      spell: {
        id: this.spellIdNum(i),
        name: this.spellNameId[i]! === 0 ? '' : this.str(this.spellNameId[i]!),
        school,
        schools: decodeSpellSchools(school),
      },
      amount: this.amount[i]!,
      details: this.details(i),
    };
  }

  /** Short display label for a unit id (name, else raw GUID). */
  unitLabel(unitId: number): string {
    if (unitId === 0) return '';
    return this.actorName(unitId) || this.str(unitId);
  }
}

function parseIntArray(raw: string): number[] {
  let body = raw.trim();
  if ((body.startsWith('[') && body.endsWith(']')) || (body.startsWith('(') && body.endsWith(')'))) {
    body = body.slice(1, -1);
  }
  if (body.trim() === '') return [];
  return body.split(',').map((p) => Number(p.trim()));
}
