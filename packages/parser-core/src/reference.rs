//! TEST-ONLY reference parser: the original serde_json `Value`-producing path,
//! ported verbatim from the ground-truth lib.rs (compact output — rawLine/rawFields/
//! unmappedFields/warnings omitted, they're not parsed data). The differential test
//! asserts the columnar store reproduces every value this path emits, so the port
//! cannot silently change parsing behavior.
#![cfg(test)]

use serde_json::{json, Map, Number, Value};
use std::collections::HashSet;

use crate::wow::csv::{split_wow_csv, CsvField};
use crate::wow::fieldspec::{
    metadata_fields, special_common_details, suffix_fields, FieldSpec, FieldType,
};
use crate::wow::line::split_timestamp_and_payload;
use crate::wow::scalars::{
    is_hex, looks_like_float, parse_boolean, parse_hex, parse_hex_or_integer, parse_integer,
    to_camel_case, to_hex, MAX_SAFE_INTEGER,
};
use crate::wow::shape::{describe_advanced_block, infer_shape, should_parse_advanced, ADVANCED_BLOCK_LEN};
use crate::wow::timestamp::{epoch_ms, Timestamp};

pub fn reference_parse(line: &str) -> Value {
    let raw_line = line.trim_end_matches('\r').to_string();

    let parts = match split_timestamp_and_payload(&raw_line) {
        Ok(parts) => parts,
        Err(error) => return malformed(&error, None),
    };
    let timestamp = parts.timestamp;

    let fields = match split_wow_csv(parts.payload) {
        Ok(fields) => fields,
        Err(error) => return malformed(&error, timestamp.as_ref()),
    };

    let event_type = match fields.first().and_then(|f| f.value.as_deref()) {
        Some(value) if !value.is_empty() => value.to_string(),
        _ => return malformed("Missing event type", timestamp.as_ref()),
    };

    if event_type == "COMBAT_LOG_VERSION" {
        return parse_version_header(timestamp.as_ref(), &fields);
    }
    parse_event(timestamp.as_ref(), &fields, &event_type)
}

fn malformed(error: &str, timestamp: Option<&Timestamp>) -> Value {
    let mut object = Map::new();
    object.insert("kind".into(), json!("malformed"));
    if let Some(ts) = timestamp {
        object.insert("timestampMs".into(), json!(epoch_ms(ts)));
    }
    object.insert("error".into(), json!(error));
    Value::Object(object)
}

fn parse_version_header(timestamp: Option<&Timestamp>, fields: &[CsvField]) -> Value {
    let mut version_options = Map::new();
    for index in (2..fields.len()).step_by(2) {
        let Some(key) = fields.get(index).and_then(|f| f.value.as_deref()) else {
            continue;
        };
        version_options.insert(
            to_camel_case(&key.to_lowercase()),
            generic_value(fields.get(index + 1)),
        );
    }

    let mut object = Map::new();
    object.insert("kind".into(), json!("version"));
    insert_ts(&mut object, timestamp);
    object.insert("eventType".into(), json!("COMBAT_LOG_VERSION"));
    object.insert("formatVersion".into(), integer_value(fields.get(1)));
    object.insert("advancedLogEnabled".into(), bool_value(fields.get(3)));
    object.insert("buildVersion".into(), string_or_null(fields.get(5)));
    object.insert("projectId".into(), integer_value(fields.get(7)));
    object.insert("options".into(), Value::Object(version_options));
    Value::Object(object)
}

fn parse_event(timestamp: Option<&Timestamp>, fields: &[CsvField], event_type: &str) -> Value {
    if event_type == "SPELL_ABSORBED" {
        return parse_spell_absorbed(timestamp, fields);
    }

    let shape = infer_shape(event_type);
    let mut consumed = HashSet::from([0usize]);
    let mut details = Map::new();
    let mut source = None;
    let mut target = None;
    let mut spell = None;
    let mut advanced = None;
    let mut cursor = 1;
    let mut format = if shape.no_source_target { "metadata" } else { "unknown" };

    if shape.no_source_target {
        parse_field_list(fields, metadata_fields(event_type), 0, &mut details, &mut consumed);
        cursor = next_unconsumed_index(&consumed);
    } else if fields.len() >= 9 {
        source = Some(parse_unit_block(fields, 1, &mut consumed));
        target = Some(parse_unit_block(fields, 5, &mut consumed));
        cursor = 9;
        format = "standard";
    }

    if shape.has_spell_prefix && fields.len() >= 12 {
        spell = Some(parse_spell_block(fields, 9, &mut consumed));
        cursor = 12;
    }

    let advanced_start = cursor;
    let has_advanced = should_parse_advanced(fields.len(), &shape, advanced_start);
    if has_advanced {
        advanced = Some(parse_advanced_block(fields, advanced_start, describe_advanced_block(&shape), &mut consumed));
        cursor = advanced_start + ADVANCED_BLOCK_LEN;
        format = "advanced";
    }

    let suffix = suffix_fields(shape.suffix.as_deref(), has_advanced, shape.support, shape.prefix);
    if !suffix.is_empty() {
        parse_field_list(fields, &suffix, cursor, &mut details, &mut consumed);
    } else if let Some(common) = special_common_details(event_type) {
        parse_field_list(fields, common, cursor, &mut details, &mut consumed);
    }

    let mut object = Map::new();
    object.insert("kind".into(), json!("event"));
    insert_ts(&mut object, timestamp);
    object.insert("eventType".into(), json!(shape.event_type));
    object.insert("format".into(), json!(format));
    if let Some(source) = source {
        object.insert("source".into(), source);
    }
    if let Some(target) = target {
        object.insert("target".into(), target);
    }
    if let Some(spell) = spell {
        object.insert("spell".into(), spell);
    }
    if let Some(advanced) = advanced {
        object.insert("advanced".into(), advanced);
    }
    object.insert("details".into(), Value::Object(details));
    Value::Object(object)
}

fn parse_spell_absorbed(timestamp: Option<&Timestamp>, fields: &[CsvField]) -> Value {
    let mut consumed = HashSet::from([0usize]);
    let mut details = Map::new();
    let attacker = parse_unit_block(fields, 1, &mut consumed);
    let defender = parse_unit_block(fields, 5, &mut consumed);
    details.insert("attacker".into(), attacker.clone());
    details.insert("defender".into(), defender.clone());

    if fields.len() >= 22 {
        details.insert("damageSpell".into(), parse_spell_block(fields, 9, &mut consumed));
        details.insert("absorber".into(), parse_unit_block(fields, 12, &mut consumed));
        details.insert("shieldSpell".into(), parse_spell_block(fields, 16, &mut consumed));
        parse_field_list(
            fields,
            &[
                FieldSpec::at(19, "amount", FieldType::Integer),
                FieldSpec::at(20, "totalAmount", FieldType::Integer),
                FieldSpec::at(21, "critical", FieldType::BoolOrNil),
            ],
            0,
            &mut details,
            &mut consumed,
        );
    } else {
        details.insert("absorber".into(), parse_unit_block(fields, 9, &mut consumed));
        details.insert("shieldSpell".into(), parse_spell_block(fields, 13, &mut consumed));
        parse_field_list(
            fields,
            &[
                FieldSpec::at(16, "amount", FieldType::Integer),
                FieldSpec::at(17, "totalAmount", FieldType::Integer),
                FieldSpec::at(18, "critical", FieldType::BoolOrNil),
            ],
            0,
            &mut details,
            &mut consumed,
        );
    }

    let mut object = Map::new();
    object.insert("kind".into(), json!("event"));
    insert_ts(&mut object, timestamp);
    object.insert("eventType".into(), json!("SPELL_ABSORBED"));
    object.insert("format".into(), json!("standard"));
    object.insert("source".into(), attacker);
    object.insert("target".into(), defender);
    object.insert("details".into(), Value::Object(details));
    Value::Object(object)
}

fn insert_ts(object: &mut Map<String, Value>, timestamp: Option<&Timestamp>) {
    if let Some(ts) = timestamp {
        object.insert("timestampMs".into(), json!(epoch_ms(ts)));
    }
}

fn parse_unit_block(fields: &[CsvField], start: usize, consumed: &mut HashSet<usize>) -> Value {
    for index in start..start + 4 {
        consumed.insert(index);
    }
    json!({
        "guid": string_or_null(fields.get(start)),
        "name": string_or_null(fields.get(start + 1)),
        "flags": decode_unit_flags(fields.get(start + 2).and_then(|f| f.value.as_deref())),
        "raidFlags": decode_raid_flags(fields.get(start + 3).and_then(|f| f.value.as_deref())),
    })
}

fn parse_spell_block(fields: &[CsvField], start: usize, consumed: &mut HashSet<usize>) -> Value {
    consumed.insert(start);
    consumed.insert(start + 1);
    consumed.insert(start + 2);
    json!({
        "id": integer_value(fields.get(start)),
        "name": string_or_null(fields.get(start + 1)),
        "school": decode_spell_school(parse_hex_or_integer(fields.get(start + 2).and_then(|f| f.value.as_deref()))),
    })
}

fn parse_advanced_block(fields: &[CsvField], start: usize, describes: Option<&'static str>, consumed: &mut HashSet<usize>) -> Value {
    for index in start..start + ADVANCED_BLOCK_LEN {
        consumed.insert(index);
    }
    let mut object = Map::new();
    object.insert("startIndex".into(), json!(start));
    if let Some(describes) = describes {
        object.insert("describes".into(), json!(describes));
    }
    object.insert("infoGuid".into(), string_or_null(fields.get(start)));
    object.insert("ownerGuid".into(), string_or_null(fields.get(start + 1)));
    object.insert("currentHp".into(), integer_value(fields.get(start + 2)));
    object.insert("maxHp".into(), integer_value(fields.get(start + 3)));
    object.insert("attackPower".into(), integer_value(fields.get(start + 4)));
    object.insert("spellPower".into(), integer_value(fields.get(start + 5)));
    object.insert("armor".into(), integer_value(fields.get(start + 6)));
    object.insert("absorb".into(), integer_value(fields.get(start + 7)));
    object.insert("unknown1".into(), integer_value(fields.get(start + 8)));
    object.insert("unknown2".into(), integer_value(fields.get(start + 9)));
    object.insert("powerType".into(), integer_value(fields.get(start + 10)));
    object.insert("currentPower".into(), integer_value(fields.get(start + 11)));
    object.insert("maxPower".into(), integer_value(fields.get(start + 12)));
    object.insert("powerCost".into(), integer_value(fields.get(start + 13)));
    object.insert(
        "position".into(),
        json!({
            "x": float_value(fields.get(start + 14)),
            "y": float_value(fields.get(start + 15)),
            "uiMapId": integer_value(fields.get(start + 16)),
            "facing": float_value(fields.get(start + 17)),
        }),
    );
    object.insert("itemLevel".into(), integer_value(fields.get(start + 18)));
    Value::Object(object)
}

fn parse_field_list(fields: &[CsvField], specs: &[FieldSpec], start: usize, target: &mut Map<String, Value>, consumed: &mut HashSet<usize>) {
    for (spec_index, spec) in specs.iter().enumerate() {
        let field_index = spec.offset.unwrap_or(start + spec_index);
        let Some(field) = fields.get(field_index) else {
            continue;
        };
        consumed.insert(field_index);
        target.insert(spec.name.to_string(), read_field(Some(field), spec.field_type));
    }
}

fn next_unconsumed_index(consumed: &HashSet<usize>) -> usize {
    let mut index = 0;
    while consumed.contains(&index) {
        index += 1;
    }
    index
}

fn generic_value(field: Option<&CsvField>) -> Value {
    let Some(value) = field.and_then(|f| f.value.as_deref()) else {
        return Value::Null;
    };
    if let Some(hex) = value.strip_prefix("0x").or_else(|| value.strip_prefix("0X")) {
        if is_hex(hex) {
            if let Ok(parsed) = i64::from_str_radix(hex, 16) {
                return safe_integer_json(parsed, value);
            }
        }
    }
    if let Some(parsed) = parse_integer(value) {
        return safe_integer_json(parsed, value);
    }
    if looks_like_float(value) {
        if let Ok(parsed) = value.parse::<f64>() {
            if parsed.is_finite() {
                return Number::from_f64(parsed).map(Value::Number).unwrap_or_else(|| json!(value));
            }
        }
    }
    match value {
        "true" => Value::Bool(true),
        "false" => Value::Bool(false),
        _ => json!(value),
    }
}

fn read_field(field: Option<&CsvField>, field_type: FieldType) -> Value {
    let Some(value) = field.and_then(|f| f.value.as_deref()) else {
        return Value::Null;
    };
    match field_type {
        FieldType::Integer => parse_integer(value).map_or(Value::Null, |v| json!(v)),
        FieldType::Float => value
            .parse::<f64>()
            .ok()
            .filter(|v| v.is_finite())
            .and_then(Number::from_f64)
            .map(Value::Number)
            .unwrap_or(Value::Null),
        FieldType::Hex => parse_hex(value).map_or(Value::Null, |v| json!(v)),
        FieldType::Bool | FieldType::BoolOrNil => parse_boolean(value).map_or(Value::Null, Value::Bool),
        FieldType::SpellSchool => decode_spell_school(parse_hex_or_integer(Some(value))),
        FieldType::IntegerArray => parse_integer_array(value),
        FieldType::String => json!(value),
    }
}

fn integer_value(field: Option<&CsvField>) -> Value {
    field.and_then(|f| f.value.as_deref()).and_then(parse_integer).map_or(Value::Null, |v| json!(v))
}
fn float_value(field: Option<&CsvField>) -> Value {
    field
        .and_then(|f| f.value.as_deref())
        .and_then(|v| v.parse::<f64>().ok())
        .filter(|v| v.is_finite())
        .and_then(Number::from_f64)
        .map(Value::Number)
        .unwrap_or(Value::Null)
}
fn bool_value(field: Option<&CsvField>) -> Value {
    field.and_then(|f| f.value.as_deref()).and_then(parse_boolean).map_or(Value::Null, Value::Bool)
}
fn string_or_null(field: Option<&CsvField>) -> Value {
    field.and_then(|f| f.value.as_deref()).map_or(Value::Null, |v| json!(v))
}

fn parse_integer_array(value: &str) -> Value {
    let trimmed = value.trim();
    let body = if (trimmed.starts_with('[') && trimmed.ends_with(']'))
        || (trimmed.starts_with('(') && trimmed.ends_with(')'))
    {
        &trimmed[1..trimmed.len() - 1]
    } else {
        trimmed
    };
    if body.trim().is_empty() {
        return Value::Array(Vec::new());
    }
    Value::Array(
        body.split(',')
            .map(|part| {
                let trimmed = part.trim();
                parse_integer(trimmed).map_or_else(|| json!(trimmed), |v| json!(v))
            })
            .collect(),
    )
}

fn decode_unit_flags(value: Option<&str>) -> Value {
    let Some(raw) = parse_hex_or_integer(value) else {
        return Value::Null;
    };
    json!({ "raw": raw, "hex": to_hex(raw) })
}
fn decode_raid_flags(value: Option<&str>) -> Value {
    let Some(raw) = parse_hex_or_integer(value) else {
        return Value::Null;
    };
    json!({ "raw": raw, "hex": to_hex(raw) })
}
fn decode_spell_school(value: Option<i64>) -> Value {
    let Some(raw) = value else {
        return Value::Null;
    };
    json!({ "raw": raw, "hex": to_hex(raw) })
}

fn safe_integer_json(parsed: i64, original: &str) -> Value {
    if parsed.abs() <= MAX_SAFE_INTEGER {
        json!(parsed)
    } else {
        json!(original)
    }
}
