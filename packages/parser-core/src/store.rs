//! Columnar (structure-of-arrays) event store — v2, the port target.
//!
//! Hot typed columns hold the universal structured scalars every analytic reaches
//! for: timestamp, event type, the source/target unit blocks, the spell block, and a
//! derived primary `amount`. Every other parsed field (FieldSpec details, the 19-field
//! advanced block, metadata/version/malformed extras) lands in a per-event SIDE TABLE
//! keyed by an interned field-name id — so the long tail is preserved without bloating
//! the hot columns. See `builder.rs` for how the ported field logic routes into this.
//!
//! Null/absent sentinels: interned-string id 0 = empty; `I64_NULL`/`I32_NULL` mark an
//! absent numeric (the old path emitted JSON `null`).

use rustc_hash::FxHashMap;

use crate::intern::Interner;

pub const I64_NULL: i64 = i64::MIN;
pub const I32_NULL: i32 = i32::MIN;

/// Record classification (mirrors the old `kind`).
pub mod record_kind {
    pub const MALFORMED: u8 = 0;
    pub const EVENT: u8 = 1;
    pub const VERSION: u8 = 2;
}

/// Event layout classification (mirrors the old `format`).
pub mod format_id {
    pub const UNKNOWN: u8 = 0;
    pub const STANDARD: u8 = 1;
    pub const ADVANCED: u8 = 2;
    pub const METADATA: u8 = 3;
}

/// Side-table value kinds.
pub mod side_kind {
    pub const NULL: u8 = 0;
    pub const INT: u8 = 1;
    pub const FLOAT: u8 = 2;
    pub const BOOL: u8 = 3;
    pub const STRING: u8 = 4;
    /// Integer array (e.g. CHALLENGE_MODE affixes); `ival` is an interned id of the
    /// raw bracketed text, decoded on demand by the engine.
    pub const INT_ARRAY: u8 = 5;
}

#[derive(Clone, Copy, Default)]
pub struct UnitCols {
    pub guid: u32,
    pub name: u32,
    pub flags: i64,
    pub raid_flags: i64,
}

/// A fully-assembled row plus its side entries, committed atomically so every column
/// stays the same length (dense SoA).
pub struct Row {
    pub ts_ms: f64,
    pub event_type_id: u32,
    pub record_kind: u8,
    pub format_id: u8,
    pub source: UnitCols,
    pub target: UnitCols,
    pub spell_id: i32,
    pub spell_name: u32,
    pub spell_school: i64,
    /// Derived primary amount (damage/heal) for analytics. 0.0 when absent. Not part
    /// of the differential contract — the authoritative integer lives in the side table.
    pub amount: f64,
}

impl Default for Row {
    fn default() -> Self {
        Self {
            ts_ms: f64::NAN,
            event_type_id: 0,
            record_kind: record_kind::EVENT,
            format_id: format_id::UNKNOWN,
            source: UnitCols::default(),
            target: UnitCols::default(),
            spell_id: I32_NULL,
            spell_name: 0,
            spell_school: I64_NULL,
            amount: 0.0,
        }
    }
}

pub struct EventStore {
    // ---- hot event columns ----
    pub ts_ms: Vec<f64>,
    pub event_type_id: Vec<u32>,
    pub record_kind: Vec<u8>,
    pub format_id: Vec<u8>,
    pub source_guid: Vec<u32>,
    pub source_name: Vec<u32>,
    pub source_flags: Vec<i64>,
    pub source_raid_flags: Vec<i64>,
    pub target_guid: Vec<u32>,
    pub target_name: Vec<u32>,
    pub target_flags: Vec<i64>,
    pub target_raid_flags: Vec<i64>,
    pub spell_id: Vec<i32>,
    pub spell_name: Vec<u32>,
    pub spell_school: Vec<i64>,
    pub amount: Vec<f64>,

    // ---- per-event side table (long-tail fields) ----
    pub side_offsets: Vec<u32>, // len == events + 1
    pub side_name: Vec<u32>,
    pub side_kind: Vec<u8>,
    pub side_ival: Vec<i64>,
    pub side_fval: Vec<f64>,

    // ---- string interning ----
    pub interner: Interner,

    /// Cache of interned ids for `&'static` field names, keyed by the name's stable
    /// address. Lets the hot path hash a `usize` instead of the string content on every
    /// detail field (~tens of millions of calls per log).
    static_name_ids: FxHashMap<usize, u32>,

    // ---- actor side table (guid id -> name id) ----
    actor_seen: FxHashMap<u32, u32>,
    pub actor_guid: Vec<u32>,
    pub actor_name: Vec<u32>,

    // ---- spell side table (numeric spell id -> name id) ----
    spell_seen: FxHashMap<i32, u32>,
    pub spell_ids: Vec<i32>,
    pub spell_names: Vec<u32>,
}

impl EventStore {
    pub fn with_capacity(n: usize) -> Self {
        let mut side_offsets = Vec::with_capacity(n + 1);
        side_offsets.push(0);
        Self {
            ts_ms: Vec::with_capacity(n),
            event_type_id: Vec::with_capacity(n),
            record_kind: Vec::with_capacity(n),
            format_id: Vec::with_capacity(n),
            source_guid: Vec::with_capacity(n),
            source_name: Vec::with_capacity(n),
            source_flags: Vec::with_capacity(n),
            source_raid_flags: Vec::with_capacity(n),
            target_guid: Vec::with_capacity(n),
            target_name: Vec::with_capacity(n),
            target_flags: Vec::with_capacity(n),
            target_raid_flags: Vec::with_capacity(n),
            spell_id: Vec::with_capacity(n),
            spell_name: Vec::with_capacity(n),
            spell_school: Vec::with_capacity(n),
            amount: Vec::with_capacity(n),
            side_offsets,
            side_name: Vec::new(),
            side_kind: Vec::new(),
            side_ival: Vec::new(),
            side_fval: Vec::new(),
            interner: Interner::new(),
            static_name_ids: FxHashMap::default(),
            actor_seen: FxHashMap::default(),
            actor_guid: Vec::new(),
            actor_name: Vec::new(),
            spell_seen: FxHashMap::default(),
            spell_ids: Vec::new(),
            spell_names: Vec::new(),
        }
    }

    #[inline]
    pub fn len(&self) -> usize {
        self.ts_ms.len()
    }

    /// Intern a `&'static` field name, caching the id by the name's stable address so
    /// repeat calls skip hashing the string content.
    #[inline]
    pub fn intern_static_name(&mut self, name: &'static str) -> u32 {
        let key = name.as_ptr() as usize;
        if let Some(&id) = self.static_name_ids.get(&key) {
            return id;
        }
        let id = self.interner.intern(name);
        self.static_name_ids.insert(key, id);
        id
    }

    /// Commit a row plus its side entries (pushed contiguously). Keeps all columns
    /// the same length.
    pub fn push_row(&mut self, row: &Row, side: &[SideEntry]) {
        self.ts_ms.push(row.ts_ms);
        self.event_type_id.push(row.event_type_id);
        self.record_kind.push(row.record_kind);
        self.format_id.push(row.format_id);
        self.source_guid.push(row.source.guid);
        self.source_name.push(row.source.name);
        self.source_flags.push(row.source.flags);
        self.source_raid_flags.push(row.source.raid_flags);
        self.target_guid.push(row.target.guid);
        self.target_name.push(row.target.name);
        self.target_flags.push(row.target.flags);
        self.target_raid_flags.push(row.target.raid_flags);
        self.spell_id.push(row.spell_id);
        self.spell_name.push(row.spell_name);
        self.spell_school.push(row.spell_school);
        self.amount.push(row.amount);

        for e in side {
            self.side_name.push(e.name);
            self.side_kind.push(e.kind);
            self.side_ival.push(e.ival);
            self.side_fval.push(e.fval);
        }
        self.side_offsets.push(self.side_name.len() as u32);
    }

    /// Record a real actor (guid -> name, first name wins) in the roster table. Skips
    /// missing/"nil"/all-zero GUIDs. The guid is interned for the hot column separately
    /// by the builder, so this only maintains the resolvable name roster.
    #[inline]
    pub fn note_actor(&mut self, guid: Option<&str>, name: Option<&str>) {
        let Some(guid) = guid else { return };
        if guid.is_empty() || guid == "0000000000000000" {
            return;
        }
        let id = self.interner.intern(guid);
        if let Some(name) = name {
            if !name.is_empty() && !self.actor_seen.contains_key(&id) {
                let name_id = self.interner.intern(name);
                self.actor_seen.insert(id, name_id);
                self.actor_guid.push(id);
                self.actor_name.push(name_id);
            }
        }
    }

    /// Record a spell's name against its numeric id (first one wins).
    #[inline]
    pub fn record_spell(&mut self, spell_id: i32, name: Option<&str>) {
        if spell_id == I32_NULL {
            return;
        }
        if let Some(name) = name {
            if !name.is_empty() && !self.spell_seen.contains_key(&spell_id) {
                let name_id = self.interner.intern(name);
                self.spell_seen.insert(spell_id, name_id);
                self.spell_ids.push(spell_id);
                self.spell_names.push(name_id);
            }
        }
    }
}

/// One side-table value, assembled by the builder before commit.
#[derive(Clone, Copy)]
pub struct SideEntry {
    pub name: u32,
    pub kind: u8,
    pub ival: i64,
    pub fval: f64,
}

impl SideEntry {
    pub fn null(name: u32) -> Self {
        Self { name, kind: side_kind::NULL, ival: 0, fval: 0.0 }
    }
    pub fn int(name: u32, v: i64) -> Self {
        Self { name, kind: side_kind::INT, ival: v, fval: 0.0 }
    }
    pub fn float(name: u32, v: f64) -> Self {
        Self { name, kind: side_kind::FLOAT, ival: 0, fval: v }
    }
    pub fn boolean(name: u32, v: bool) -> Self {
        Self { name, kind: side_kind::BOOL, ival: v as i64, fval: 0.0 }
    }
    pub fn string(name: u32, id: u32) -> Self {
        Self { name, kind: side_kind::STRING, ival: id as i64, fval: 0.0 }
    }
    pub fn int_array(name: u32, raw_id: u32) -> Self {
        Self { name, kind: side_kind::INT_ARRAY, ival: raw_id as i64, fval: 0.0 }
    }
}
