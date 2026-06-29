//! Differential test: parse each fixture line BOTH ways — the ground-truth serde_json
//! reference path and the new columnar store — and assert that every value the
//! reference produced appears, equal, in the columnar store. This is the guarantee
//! that the port did not silently change parsing behavior.
#![cfg(test)]

use serde_json::{json, Map, Value};

use crate::builder::parse_into;
use crate::reference::reference_parse;
use crate::store::{side_kind, EventStore, I32_NULL, I64_NULL};

// ---- fixtures: at least one of each required category ----
const ADVANCED_SPELL_DAMAGE: &str = "5/14/2026 21:27:46.123-0500  SPELL_DAMAGE,Player-3676-0A000001,\"Sparkl, Example\",0x511,0x0,Creature-0-4229-2552-12345-198594-0000123456,\"Training Dummy\",0x10a48,0x0,133,\"Fireball\",0x4,Creature-0-4229-2552-12345-198594-0000123456,0000000000000000,950000,1000000,0,0,4170,0,0,0,0,0,0,0,42.12,57.33,2291,1.5708,0,58211,64100,-1,0x4,0,0,0,1,nil,nil,ST";

const SPELL_ABSORBED: &str = "5/14 21:27:49.123  SPELL_ABSORBED,Player-1,\"Mage\",0x511,0x0,Player-2,\"Priest\",0x514,0x0,133,\"Fireball\",0x4,Player-2,\"Priest\",0x514,0x0,17,\"Power Word: Shield\",0x2,5000,20000,nil";

const ENCOUNTER_START: &str = "5/14/2026 21:27:46.123-0500  ENCOUNTER_START,2902,\"Ulgrax the Devourer\",16,20,2657";

const MALFORMED: &str = "this is not a valid combat log line";

const VERSION: &str = "COMBAT_LOG_VERSION,22,ADVANCED_LOG_ENABLED,1,BUILD_VERSION,12.0.0,PROJECT_ID,1";

const NON_ADVANCED_DAMAGE: &str = "5/14 21:27:49.123  SPELL_DAMAGE,Player-1,\"Mage\",0x511,0x0,Creature-1,\"Dummy\",0xa48,0x0,133,\"Fireball\",0x4,1234,0,0x4,0,0,0,nil,nil,nil,nil";

const ADVANCED_HEAL: &str = "5/14/2026 21:27:46.123-0500  SPELL_HEAL,Player-2,\"Priest\",0x511,0x0,Player-1,\"Mage\",0x511,0x0,2061,\"Flash Heal\",0x2,Player-1,0000000000000000,500000,600000,0,0,0,0,0,0,0,0,0,0,12.0,13.0,2291,0.0,0,9000,8000,1000,500,nil";

const STAGGER_CLEAR: &str = "6/2/2026 09:50:05.708-5  STAGGER_CLEAR,Player-121-0ADA76FE,18273.871094";

const FIXTURES: &[(&str, &str)] = &[
    ("advanced SPELL_DAMAGE", ADVANCED_SPELL_DAMAGE),
    ("SPELL_ABSORBED", SPELL_ABSORBED),
    ("ENCOUNTER_START", ENCOUNTER_START),
    ("malformed", MALFORMED),
    ("COMBAT_LOG_VERSION", VERSION),
    ("non-advanced SPELL_DAMAGE", NON_ADVANCED_DAMAGE),
    ("advanced SPELL_HEAL", ADVANCED_HEAL),
    ("STAGGER_CLEAR metadata", STAGGER_CLEAR),
];

#[test]
fn columnar_store_reproduces_reference_values() {
    for (label, line) in FIXTURES {
        let reference = flatten_reference(&reference_parse(line));
        let columnar = flatten_columnar(line);

        for (key, expected) in &reference {
            let actual = columnar.get(key).unwrap_or_else(|| {
                panic!("[{label}] columnar store missing field `{key}` (expected {expected})")
            });
            assert!(
                values_equal(expected, actual),
                "[{label}] field `{key}`: reference={expected} columnar={actual}",
            );
        }
    }
}

// ---------------------------------------------------------------------------
// Build a flat name->value map from the columnar store for a single-line parse.
// ---------------------------------------------------------------------------
fn flatten_columnar(line: &str) -> Map<String, Value> {
    let mut store = EventStore::with_capacity(8);
    parse_into(line, &mut store);
    assert_eq!(store.len(), 1, "expected exactly one row for: {line}");

    let mut out = Map::new();
    let et = store.event_type_id[0];
    if et != 0 {
        out.insert("eventType".into(), json!(store.interner.get(et)));
    }
    out.insert("timestampMs".into(), num_or_null_f64(store.ts_ms[0]));

    insert_unit(&mut out, &store, "source", store.source_guid[0], store.source_name[0], store.source_flags[0], store.source_raid_flags[0]);
    insert_unit(&mut out, &store, "target", store.target_guid[0], store.target_name[0], store.target_flags[0], store.target_raid_flags[0]);

    if store.spell_id[0] != I32_NULL {
        out.insert("spell.id".into(), json!(store.spell_id[0] as i64));
    } else {
        out.insert("spell.id".into(), Value::Null);
    }
    out.insert("spell.name".into(), str_or_null(&store, store.spell_name[0]));
    out.insert("spell.school".into(), num_or_null_i64(store.spell_school[0]));

    // side-table entries for event 0
    let start = store.side_offsets[0] as usize;
    let end = store.side_offsets[1] as usize;
    for i in start..end {
        let name = store.interner.get(store.side_name[i]).to_string();
        let value = match store.side_kind[i] {
            side_kind::NULL => Value::Null,
            side_kind::INT => json!(store.side_ival[i]),
            side_kind::FLOAT => json!(store.side_fval[i]),
            side_kind::BOOL => json!(store.side_ival[i] != 0),
            side_kind::STRING => json!(store.interner.get(store.side_ival[i] as u32)),
            side_kind::INT_ARRAY => parse_integer_array(store.interner.get(store.side_ival[i] as u32)),
            _ => Value::Null,
        };
        out.insert(name, value);
    }
    out
}

fn insert_unit(out: &mut Map<String, Value>, store: &EventStore, prefix: &str, guid: u32, name: u32, flags: i64, raid: i64) {
    out.insert(format!("{prefix}.guid"), str_or_null(store, guid));
    out.insert(format!("{prefix}.name"), str_or_null(store, name));
    out.insert(format!("{prefix}.flags"), num_or_null_i64(flags));
    out.insert(format!("{prefix}.raidFlags"), num_or_null_i64(raid));
}

fn str_or_null(store: &EventStore, id: u32) -> Value {
    if id == 0 {
        Value::Null
    } else {
        json!(store.interner.get(id))
    }
}
fn num_or_null_i64(v: i64) -> Value {
    if v == I64_NULL {
        Value::Null
    } else {
        json!(v)
    }
}
fn num_or_null_f64(v: f64) -> Value {
    if v.is_nan() {
        Value::Null
    } else {
        json!(v)
    }
}

// ---------------------------------------------------------------------------
// Flatten the reference JSON into the same key namespace the columnar map uses.
//   * source/target/spell keep their prefix ("source.guid", ...)
//   * details/advanced children are flattened bare ("amount", "currentHp", "position.x")
//   * decoded {raw,hex,...} objects collapse to their `raw`
//   * details.attacker / details.defender are skipped (duplicates of source/target)
// ---------------------------------------------------------------------------
fn flatten_reference(value: &Value) -> Map<String, Value> {
    let mut out = Map::new();
    let Some(obj) = value.as_object() else {
        return out;
    };
    for (key, v) in obj {
        match key.as_str() {
            "kind" | "format" => {}
            "eventType" | "timestampMs" => {
                out.insert(key.clone(), v.clone());
            }
            "source" | "target" | "spell" | "options" => flatten(key, v, &mut out),
            "details" | "advanced" => {
                if let Some(child) = v.as_object() {
                    for (ck, cv) in child {
                        if key == "details" && (ck == "attacker" || ck == "defender") {
                            continue;
                        }
                        flatten(ck, cv, &mut out);
                    }
                }
            }
            other => {
                out.insert(other.to_string(), v.clone());
            }
        }
    }
    out
}

fn flatten(prefix: &str, value: &Value, out: &mut Map<String, Value>) {
    match value {
        Value::Object(map) if map.contains_key("raw") => {
            // decoded scalar object (flags / school): collapse to raw
            out.insert(prefix.to_string(), map["raw"].clone());
        }
        Value::Object(map) => {
            for (k, v) in map {
                flatten(&format!("{prefix}.{k}"), v, out);
            }
        }
        _ => {
            out.insert(prefix.to_string(), value.clone());
        }
    }
}

fn values_equal(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(x), Value::Number(y)) => match (x.as_f64(), y.as_f64()) {
            (Some(p), Some(q)) => (p - q).abs() <= 1e-6 * (1.0 + p.abs().max(q.abs())),
            _ => a == b,
        },
        _ => a == b,
    }
}

// mirror of reference::parse_integer_array for decoding INT_ARRAY side values
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
                let t = part.trim();
                crate::wow::scalars::parse_integer(t).map_or_else(|| json!(t), |v| json!(v))
            })
            .collect(),
    )
}
