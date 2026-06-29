//! Columnar event builder. Mirrors the ground-truth `parse_event` /
//! `parse_spell_absorbed` / `parse_version_header` control flow EXACTLY, but routes
//! each decoded value into the hot columns (timestamp, source/target unit blocks,
//! spell block, derived amount) or the per-event side table (every FieldSpec detail,
//! the advanced block, version/metadata/malformed extras). The differential test pins
//! that this routing preserves every value the old serde_json path produced.

use crate::store::{format_id, record_kind, EventStore, Row, SideEntry, UnitCols, I32_NULL, I64_NULL};
use crate::wow::csv::{split_wow_csv_into, CsvField};
use crate::wow::fieldspec::{
    metadata_fields, special_common_details, suffix_fields_into, FieldSpec, FieldType,
};
use crate::wow::line::split_timestamp_and_payload;
use crate::wow::scalars::{
    is_hex, looks_like_float, parse_boolean, parse_hex, parse_hex_or_integer, parse_integer,
    to_camel_case, MAX_SAFE_INTEGER,
};
use crate::wow::shape::{
    describe_advanced_block, infer_shape, should_parse_advanced, ADVANCED_BLOCK_LEN,
};
use crate::wow::timestamp::epoch_ms;

/// Parse the whole log text into the store, one line at a time. The `fields` buffer is
/// reused across lines (every line is a slice of `text`, so they share its lifetime).
pub fn parse_into(text: &str, store: &mut EventStore) {
    let mut fields: Vec<CsvField<'_>> = Vec::new();
    let mut side: Vec<SideEntry> = Vec::new();
    let mut specs: Vec<FieldSpec> = Vec::new();
    for line in text.lines() {
        parse_line(line, store, &mut fields, &mut side, &mut specs);
    }
}

fn parse_line<'a>(
    line: &'a str,
    store: &mut EventStore,
    fields: &mut Vec<CsvField<'a>>,
    side: &mut Vec<SideEntry>,
    specs: &mut Vec<FieldSpec>,
) {
    side.clear();
    let raw_line = line.trim_end_matches('\r');
    if raw_line.is_empty() {
        return;
    }

    let parts = match split_timestamp_and_payload(raw_line) {
        Ok(parts) => parts,
        Err(error) => return push_malformed(store, side, f64::NAN, raw_line, &error),
    };
    let ts_ms = parts.timestamp.as_ref().and_then(epoch_ms).unwrap_or(f64::NAN);

    if let Err(error) = split_wow_csv_into(parts.payload, fields) {
        return push_malformed(store, side, ts_ms, raw_line, &error);
    }

    let event_type = match fields.first().and_then(|f| f.value.as_deref()) {
        Some(value) if !value.is_empty() => value,
        _ => return push_malformed(store, side, ts_ms, raw_line, "Missing event type"),
    };

    if event_type == "COMBAT_LOG_VERSION" {
        return build_version(store, side, ts_ms, fields);
    }

    build_event(store, side, ts_ms, fields, event_type, specs);
}

// ---------------------------------------------------------------------------
// malformed / version
// ---------------------------------------------------------------------------

fn push_malformed(store: &mut EventStore, side: &mut [SideEntry], ts_ms: f64, raw_line: &str, error: &str) {
    let _ = side; // malformed builds its own side entries below
    let error_id = store.interner.intern(error);
    let raw_id = store.interner.intern(raw_line);
    let n_error = store.interner.intern("error");
    let n_raw = store.interner.intern("rawLine");
    let entries = [SideEntry::string(n_error, error_id), SideEntry::string(n_raw, raw_id)];
    let row = Row {
        ts_ms,
        event_type_id: 0,
        record_kind: record_kind::MALFORMED,
        format_id: format_id::UNKNOWN,
        ..Row::default()
    };
    store.push_row(&row, &entries);
}

fn build_version(store: &mut EventStore, side: &mut Vec<SideEntry>, ts_ms: f64, fields: &[CsvField]) {
    side.clear();
    push_detail(side, store, "formatVersion", read_field(fields, 1, FieldType::Integer));
    push_detail(side, store, "advancedLogEnabled", read_field(fields, 3, FieldType::Bool));
    push_detail(side, store, "buildVersion", read_field(fields, 5, FieldType::String));
    push_detail(side, store, "projectId", read_field(fields, 7, FieldType::Integer));

    // options: every (key,value) pair from index 2 onward, camelCased keys.
    let mut index = 2;
    while index < fields.len() {
        if let Some(key) = fields.get(index).and_then(|f| f.value.as_deref()) {
            let name = format!("options.{}", to_camel_case(&key.to_lowercase()));
            let value = generic_value(fields.get(index + 1).and_then(|f| f.value.as_deref()));
            push_detail(side, store, &name, value);
        }
        index += 2;
    }

    let event_type_id = store.interner.intern("COMBAT_LOG_VERSION");
    let row = Row {
        ts_ms,
        event_type_id,
        record_kind: record_kind::VERSION,
        format_id: format_id::UNKNOWN,
        ..Row::default()
    };
    store.push_row(&row, side);
}

// ---------------------------------------------------------------------------
// events
// ---------------------------------------------------------------------------

fn build_event(
    store: &mut EventStore,
    side: &mut Vec<SideEntry>,
    ts_ms: f64,
    fields: &[CsvField],
    event_type: &str,
    specs: &mut Vec<FieldSpec>,
) {
    if event_type == "SPELL_ABSORBED" {
        return build_spell_absorbed(store, side, ts_ms, fields);
    }

    let shape = infer_shape(event_type);
    let mut source = UnitCols::default();
    let mut target = UnitCols::default();
    let mut spell_id = I32_NULL;
    let mut spell_name = 0u32;
    let mut spell_school = I64_NULL;
    let mut cursor = 1usize;
    let mut format = if shape.no_source_target {
        format_id::METADATA
    } else {
        format_id::UNKNOWN
    };

    if shape.no_source_target {
        parse_field_list(side, store, fields, metadata_fields(event_type), 0);
    } else if fields.len() >= 9 {
        source = unit_block(store, fields, 1);
        target = unit_block(store, fields, 5);
        cursor = 9;
        format = format_id::STANDARD;
    }

    if shape.has_spell_prefix && fields.len() >= 12 {
        let (id, name, school) = spell_block(store, fields, 9);
        spell_id = id;
        spell_name = name;
        spell_school = school;
        cursor = 12;
    }

    let advanced_start = cursor;
    let has_advanced = should_parse_advanced(fields.len(), &shape, advanced_start);
    if has_advanced {
        advanced_block(side, store, fields, advanced_start, describe_advanced_block(&shape));
        cursor = advanced_start + ADVANCED_BLOCK_LEN;
        format = format_id::ADVANCED;
    }

    suffix_fields_into(specs, shape.suffix.as_deref(), has_advanced, shape.support, shape.prefix);
    if !specs.is_empty() {
        parse_field_list(side, store, fields, specs, cursor);
    } else if let Some(common) = special_common_details(event_type) {
        parse_field_list(side, store, fields, common, cursor);
    }

    let amount = derive_amount(store, side);
    let event_type_id = store.interner.intern(shape.event_type);
    let row = Row {
        ts_ms,
        event_type_id,
        record_kind: record_kind::EVENT,
        format_id: format,
        source,
        target,
        spell_id,
        spell_name,
        spell_school,
        amount,
    };
    store.push_row(&row, side);
}

fn build_spell_absorbed(store: &mut EventStore, side: &mut Vec<SideEntry>, ts_ms: f64, fields: &[CsvField]) {
    let source = unit_block(store, fields, 1); // attacker
    let target = unit_block(store, fields, 5); // defender

    if fields.len() >= 22 {
        spell_block_to_side(side, store, "damageSpell", fields, 9);
        unit_block_to_side(side, store, "absorber", fields, 12);
        spell_block_to_side(side, store, "shieldSpell", fields, 16);
        parse_field_list(
            side,
            store,
            fields,
            &[
                FieldSpec::at(19, "amount", FieldType::Integer),
                FieldSpec::at(20, "totalAmount", FieldType::Integer),
                FieldSpec::at(21, "critical", FieldType::BoolOrNil),
            ],
            0,
        );
    } else {
        unit_block_to_side(side, store, "absorber", fields, 9);
        spell_block_to_side(side, store, "shieldSpell", fields, 13);
        parse_field_list(
            side,
            store,
            fields,
            &[
                FieldSpec::at(16, "amount", FieldType::Integer),
                FieldSpec::at(17, "totalAmount", FieldType::Integer),
                FieldSpec::at(18, "critical", FieldType::BoolOrNil),
            ],
            0,
        );
    }

    let amount = derive_amount(store, side);
    let event_type_id = store.interner.intern("SPELL_ABSORBED");
    let row = Row {
        ts_ms,
        event_type_id,
        record_kind: record_kind::EVENT,
        format_id: format_id::STANDARD,
        source,
        target,
        amount,
        ..Row::default()
    };
    store.push_row(&row, side);
}

// ---------------------------------------------------------------------------
// blocks
// ---------------------------------------------------------------------------

#[inline]
fn fval<'a>(fields: &'a [CsvField], i: usize) -> Option<&'a str> {
    fields.get(i).and_then(|f| f.value.as_deref())
}

fn unit_block(store: &mut EventStore, fields: &[CsvField], start: usize) -> UnitCols {
    let guid = fval(fields, start);
    let name = fval(fields, start + 1);
    store.note_actor(guid, name);
    UnitCols {
        guid: intern_opt(store, guid),
        name: intern_opt(store, name),
        flags: parse_hex_or_integer(fval(fields, start + 2)).unwrap_or(I64_NULL),
        raid_flags: parse_hex_or_integer(fval(fields, start + 3)).unwrap_or(I64_NULL),
    }
}

fn spell_block(store: &mut EventStore, fields: &[CsvField], start: usize) -> (i32, u32, i64) {
    let id = fval(fields, start)
        .and_then(parse_integer)
        .map(|v| v as i32)
        .unwrap_or(I32_NULL);
    let name = fval(fields, start + 1);
    store.record_spell(id, name);
    (
        id,
        intern_opt(store, name),
        parse_hex_or_integer(fval(fields, start + 2)).unwrap_or(I64_NULL),
    )
}

fn unit_block_to_side(side: &mut Vec<SideEntry>, store: &mut EventStore, prefix: &str, fields: &[CsvField], start: usize) {
    push_detail(side, store, &dotted(prefix, "guid"), read_field(fields, start, FieldType::String));
    push_detail(side, store, &dotted(prefix, "name"), read_field(fields, start + 1, FieldType::String));
    // unit flags/raidFlags are stored as their raw integer (engine decodes for display).
    push_detail(side, store, &dotted(prefix, "flags"), hex_or_int_value(fval(fields, start + 2)));
    push_detail(side, store, &dotted(prefix, "raidFlags"), hex_or_int_value(fval(fields, start + 3)));
}

fn spell_block_to_side(side: &mut Vec<SideEntry>, store: &mut EventStore, prefix: &str, fields: &[CsvField], start: usize) {
    push_detail(side, store, &dotted(prefix, "id"), read_field(fields, start, FieldType::Integer));
    push_detail(side, store, &dotted(prefix, "name"), read_field(fields, start + 1, FieldType::String));
    push_detail(side, store, &dotted(prefix, "school"), read_field(fields, start + 2, FieldType::SpellSchool));
}

fn advanced_block(side: &mut Vec<SideEntry>, store: &mut EventStore, fields: &[CsvField], start: usize, describes: Option<&'static str>) {
    push_detail_static(side, store, "startIndex", Decoded::Int(start as i64));
    if let Some(describes) = describes {
        let id = store.interner.intern(describes);
        push_detail_static(side, store, "describes", Decoded::Str(id));
    }
    push_detail_static(side, store, "infoGuid", read_field(fields, start, FieldType::String));
    push_detail_static(side, store, "ownerGuid", read_field(fields, start + 1, FieldType::String));
    push_detail_static(side, store, "currentHp", read_field(fields, start + 2, FieldType::Integer));
    push_detail_static(side, store, "maxHp", read_field(fields, start + 3, FieldType::Integer));
    push_detail_static(side, store, "attackPower", read_field(fields, start + 4, FieldType::Integer));
    push_detail_static(side, store, "spellPower", read_field(fields, start + 5, FieldType::Integer));
    push_detail_static(side, store, "armor", read_field(fields, start + 6, FieldType::Integer));
    push_detail_static(side, store, "absorb", read_field(fields, start + 7, FieldType::Integer));
    push_detail_static(side, store, "unknown1", read_field(fields, start + 8, FieldType::Integer));
    push_detail_static(side, store, "unknown2", read_field(fields, start + 9, FieldType::Integer));
    push_detail_static(side, store, "powerType", read_field(fields, start + 10, FieldType::Integer));
    push_detail_static(side, store, "currentPower", read_field(fields, start + 11, FieldType::Integer));
    push_detail_static(side, store, "maxPower", read_field(fields, start + 12, FieldType::Integer));
    push_detail_static(side, store, "powerCost", read_field(fields, start + 13, FieldType::Integer));
    push_detail_static(side, store, "position.x", read_field(fields, start + 14, FieldType::Float));
    push_detail_static(side, store, "position.y", read_field(fields, start + 15, FieldType::Float));
    push_detail_static(side, store, "position.uiMapId", read_field(fields, start + 16, FieldType::Integer));
    push_detail_static(side, store, "position.facing", read_field(fields, start + 17, FieldType::Float));
    push_detail_static(side, store, "itemLevel", read_field(fields, start + 18, FieldType::Integer));
}

fn parse_field_list(side: &mut Vec<SideEntry>, store: &mut EventStore, fields: &[CsvField], specs: &[FieldSpec], start: usize) {
    for (spec_index, spec) in specs.iter().enumerate() {
        let field_index = spec.offset.unwrap_or(start + spec_index);
        if field_index >= fields.len() {
            continue; // old path only emitted a warning; no data
        }
        let decoded = read_field(fields, field_index, spec.field_type);
        push_detail_static(side, store, spec.name, decoded);
    }
}

// ---------------------------------------------------------------------------
// field decoding (mirrors read_field / generic_value), producing a `Decoded`
// ---------------------------------------------------------------------------

enum Decoded {
    Null,
    Int(i64),
    Float(f64),
    Bool(bool),
    /// already-interned string id
    Str(u32),
    /// owned string interned at push time; `bool` = treat as integer-array
    StrRawOwned(String, bool),
}

fn read_field(fields: &[CsvField], index: usize, ft: FieldType) -> Decoded {
    let Some(value) = fields.get(index).and_then(|f| f.value.as_deref()) else {
        return Decoded::Null;
    };
    decode_value(value, ft)
}

fn decode_value(value: &str, ft: FieldType) -> Decoded {
    match ft {
        FieldType::Integer => parse_integer(value).map(Decoded::Int).unwrap_or(Decoded::Null),
        FieldType::Float => value
            .parse::<f64>()
            .ok()
            .filter(|v| v.is_finite())
            .map(Decoded::Float)
            .unwrap_or(Decoded::Null),
        FieldType::Hex => parse_hex(value).map(Decoded::Int).unwrap_or(Decoded::Null),
        FieldType::Bool | FieldType::BoolOrNil => {
            parse_boolean(value).map(Decoded::Bool).unwrap_or(Decoded::Null)
        }
        // School stored as its raw integer (engine decodes the school bitfield).
        FieldType::SpellSchool => parse_hex_or_integer(Some(value))
            .map(Decoded::Int)
            .unwrap_or(Decoded::Null),
        FieldType::IntegerArray => Decoded::StrRawOwned(value.to_string(), true),
        FieldType::String => Decoded::StrRawOwned(value.to_string(), false),
    }
}

fn hex_or_int_value(value: Option<&str>) -> Decoded {
    match value.and_then(|v| parse_hex_or_integer(Some(v))) {
        Some(v) => Decoded::Int(v),
        None => Decoded::Null,
    }
}

/// Mirrors `generic_value` (used by version-header options): hex -> int, int (with
/// MAX_SAFE clamp to string), float, bool, else string.
fn generic_value(value: Option<&str>) -> Decoded {
    let Some(value) = value else {
        return Decoded::Null;
    };
    if let Some(hex) = value.strip_prefix("0x").or_else(|| value.strip_prefix("0X")) {
        if is_hex(hex) {
            if let Ok(parsed) = i64::from_str_radix(hex, 16) {
                return safe_integer(parsed, value);
            }
        }
    }
    if let Some(parsed) = parse_integer(value) {
        return safe_integer(parsed, value);
    }
    if looks_like_float(value) {
        if let Ok(parsed) = value.parse::<f64>() {
            if parsed.is_finite() {
                return Decoded::Float(parsed);
            }
        }
    }
    match value {
        "true" => Decoded::Bool(true),
        "false" => Decoded::Bool(false),
        other => Decoded::StrRawOwned(other.to_string(), false),
    }
}

fn safe_integer(parsed: i64, original: &str) -> Decoded {
    if parsed.abs() <= MAX_SAFE_INTEGER {
        Decoded::Int(parsed)
    } else {
        Decoded::StrRawOwned(original.to_string(), false)
    }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/// Push a detail whose name is dynamic (built at runtime, e.g. dotted/option keys).
fn push_detail(side: &mut Vec<SideEntry>, store: &mut EventStore, name: &str, decoded: Decoded) {
    let name_id = store.interner.intern(name);
    push_detail_with_id(side, store, name_id, decoded);
}

/// Push a detail whose name is a `&'static` literal — the common hot-path case, where
/// the name id is resolved via the address-keyed cache (no string hashing).
fn push_detail_static(side: &mut Vec<SideEntry>, store: &mut EventStore, name: &'static str, decoded: Decoded) {
    let name_id = store.intern_static_name(name);
    push_detail_with_id(side, store, name_id, decoded);
}

fn push_detail_with_id(side: &mut Vec<SideEntry>, store: &mut EventStore, name_id: u32, decoded: Decoded) {
    let entry = match decoded {
        Decoded::Null => SideEntry::null(name_id),
        Decoded::Int(v) => SideEntry::int(name_id, v),
        Decoded::Float(v) => SideEntry::float(name_id, v),
        Decoded::Bool(v) => SideEntry::boolean(name_id, v),
        Decoded::Str(id) => SideEntry::string(name_id, id),
        Decoded::StrRawOwned(s, is_array) => {
            let id = store.interner.intern(&s);
            if is_array {
                SideEntry::int_array(name_id, id)
            } else {
                SideEntry::string(name_id, id)
            }
        }
    };
    side.push(entry);
}

#[inline]
fn intern_opt(store: &mut EventStore, value: Option<&str>) -> u32 {
    match value {
        Some(v) if !v.is_empty() => store.interner.intern(v),
        _ => 0,
    }
}

#[inline]
fn dotted(prefix: &str, leaf: &str) -> String {
    let mut s = String::with_capacity(prefix.len() + 1 + leaf.len());
    s.push_str(prefix);
    s.push('.');
    s.push_str(leaf);
    s
}

/// Primary amount for analytics: prefer a detail literally named "amount", else
/// "baseAmount" (advanced damage). 0.0 when neither is present as an int.
fn derive_amount(store: &mut EventStore, side: &[SideEntry]) -> f64 {
    let amount_name = store.intern_static_name("amount");
    let base_name = store.intern_static_name("baseAmount");
    let mut amount = 0.0;
    for e in side {
        if e.kind != crate::store::side_kind::INT {
            continue;
        }
        if e.name == amount_name {
            return e.ival as f64;
        }
        if e.name == base_name {
            amount = e.ival as f64;
        }
    }
    amount
}
