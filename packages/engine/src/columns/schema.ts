// Column schema constants — mirror of packages/parser-core/src/store.rs.
// Event types are now interned strings (resolve via ColumnStore.eventTypeId), so they
// are referenced by NAME here rather than a fixed numeric enum.

/** record_kind column values (mirrors store::record_kind). */
export const RecordKind = {
  MALFORMED: 0,
  EVENT: 1,
  VERSION: 2,
} as const;

/** format_id column values (mirrors store::format_id). */
export const FormatId = {
  UNKNOWN: 0,
  STANDARD: 1,
  ADVANCED: 2,
  METADATA: 3,
} as const;

/** Side-table value kinds (mirrors store::side_kind). */
export const SideKind = {
  NULL: 0,
  INT: 1,
  FLOAT: 2,
  BOOL: 3,
  STRING: 4,
  INT_ARRAY: 5,
} as const;

/** Null sentinels (mirror store::I64_NULL / I32_NULL). */
export const I64_NULL = -(2n ** 63n);
export const I32_NULL = -(2 ** 31);

/** Event-type names that represent damage to a target (amount = damage dealt). */
export const DAMAGE_EVENT_NAMES = [
  'SPELL_DAMAGE',
  'SPELL_PERIODIC_DAMAGE',
  'SPELL_BUILDING_DAMAGE',
  'RANGE_DAMAGE',
  'SWING_DAMAGE',
  'SWING_DAMAGE_LANDED',
  'ENVIRONMENTAL_DAMAGE',
  'DAMAGE_SHIELD',
  'DAMAGE_SPLIT',
] as const;

/** Event-type names that represent healing (amount = heal). */
export const HEAL_EVENT_NAMES = ['SPELL_HEAL', 'SPELL_PERIODIC_HEAL'] as const;

/** Logical column identifiers analytics declare a dependency on. */
export type ColumnId =
  | 'ts'
  | 'eventType'
  | 'recordKind'
  | 'source'
  | 'target'
  | 'spell'
  | 'amount'
  | 'side';
