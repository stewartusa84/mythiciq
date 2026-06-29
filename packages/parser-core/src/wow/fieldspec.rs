//! FieldSpec system + per-event-type field tables — ported VERBATIM from the
//! ground-truth lib.rs. These tables are the SOURCE OF TRUTH for what each event
//! contains; the differential test pins them. Only the *sink* changes downstream
//! (typed columns / side table instead of a serde_json::Map).

#[derive(Clone, Copy)]
pub enum FieldType {
    String,
    Integer,
    Float,
    Hex,
    Bool,
    BoolOrNil,
    SpellSchool,
    IntegerArray,
}

#[derive(Clone, Copy)]
pub struct FieldSpec {
    pub name: &'static str,
    pub field_type: FieldType,
    pub optional: bool,
    pub offset: Option<usize>,
}

impl FieldSpec {
    pub const fn req(name: &'static str, field_type: FieldType) -> Self {
        Self { name, field_type, optional: false, offset: None }
    }
    pub const fn opt(name: &'static str, field_type: FieldType) -> Self {
        Self { name, field_type, optional: true, offset: None }
    }
    pub const fn at(offset: usize, name: &'static str, field_type: FieldType) -> Self {
        Self { name, field_type, optional: false, offset: Some(offset) }
    }
    pub const fn opt_at(offset: usize, name: &'static str, field_type: FieldType) -> Self {
        Self { name, field_type, optional: true, offset: Some(offset) }
    }
}

const ARENA_MATCH_START_FIELDS: &[FieldSpec] = &[
    FieldSpec::at(1, "zoneId", FieldType::Integer),
    FieldSpec::at(2, "rated", FieldType::Bool),
];
const ARENA_MATCH_END_FIELDS: &[FieldSpec] = &[
    FieldSpec::at(1, "winningTeam", FieldType::Integer),
    FieldSpec::opt_at(2, "durationSeconds", FieldType::Integer),
];
const CHALLENGE_MODE_START_FIELDS: &[FieldSpec] = &[
    FieldSpec::at(1, "dungeonName", FieldType::String),
    FieldSpec::at(2, "mapId", FieldType::Integer),
    FieldSpec::at(3, "challengeModeId", FieldType::Integer),
    FieldSpec::at(4, "keystoneLevel", FieldType::Integer),
    FieldSpec::opt_at(5, "affixes", FieldType::IntegerArray),
];
const CHALLENGE_MODE_END_FIELDS: &[FieldSpec] = &[
    FieldSpec::at(1, "mapId", FieldType::Integer),
    FieldSpec::at(2, "success", FieldType::Bool),
    FieldSpec::at(3, "keystoneLevel", FieldType::Integer),
    FieldSpec::opt_at(4, "totalTimeMs", FieldType::Integer),
    // Fields 5/6 are NOT a timer. Verified across sample logs: field 5 is the RUN's dungeon
    // score (scales with key level: ~388 at +13, ~375 at +12) and field 6 is the player's
    // NEW OVERALL M+ rating (climbs monotonically across a night; the same dungeon shows
    // different values on different days). The dungeon timer is not in the log — it's curated
    // in engine `segments/challengeTimers.ts`.
    FieldSpec::opt_at(5, "runScore", FieldType::Float),
    FieldSpec::opt_at(6, "overallRating", FieldType::Float),
];
// Field layout VERIFIED against Midnight sample logs (index 0 = the COMBATANT_INFO token).
// The crit/haste/versatility stats each log a melee/ranged/spell TRIPLE; we keep the first of
// each. Mastery is the single field right before the versatility triple. The previous offsets
// were all off by one (critRating pointed at a field that is always 0, hasteRating read leech,
// etc.) — corrected here. speedRating/leechRating (14/15) and avoidanceRating (19) are placed
// positionally. The four structured blobs (talents/pvpTalents/gear/combatantAuras) arrive as
// single CSV fields (the tokenizer keeps `[...]`/`(...)` intact) and ship as raw strings parsed
// in the engine.
const COMBATANT_INFO_FIELDS: &[FieldSpec] = &[
    FieldSpec::at(1, "playerGuid", FieldType::String),
    FieldSpec::opt_at(3, "primaryStat", FieldType::Integer),
    FieldSpec::opt_at(5, "stamina", FieldType::Integer),
    FieldSpec::opt_at(11, "critRating", FieldType::Integer),
    FieldSpec::opt_at(14, "speedRating", FieldType::Integer),
    FieldSpec::opt_at(15, "leechRating", FieldType::Integer),
    FieldSpec::opt_at(16, "hasteRating", FieldType::Integer),
    FieldSpec::opt_at(19, "avoidanceRating", FieldType::Integer),
    FieldSpec::opt_at(20, "masteryRating", FieldType::Integer),
    FieldSpec::opt_at(21, "versatilityRating", FieldType::Integer),
    FieldSpec::opt_at(24, "armor", FieldType::Integer),
    FieldSpec::opt_at(25, "specId", FieldType::Integer),
    FieldSpec::opt_at(26, "talents", FieldType::String),
    FieldSpec::opt_at(27, "pvpTalents", FieldType::String),
    FieldSpec::opt_at(28, "gear", FieldType::String),
    FieldSpec::opt_at(29, "combatantAuras", FieldType::String),
];
const EMOTE_FIELDS: &[FieldSpec] = &[
    FieldSpec::at(1, "sourceGuid", FieldType::String),
    FieldSpec::at(2, "sourceName", FieldType::String),
    FieldSpec::at(3, "targetGuid", FieldType::String),
    FieldSpec::at(4, "targetName", FieldType::String),
    FieldSpec::at(5, "message", FieldType::String),
];
const ENCOUNTER_START_FIELDS: &[FieldSpec] = &[
    FieldSpec::at(1, "encounterId", FieldType::Integer),
    FieldSpec::at(2, "encounterName", FieldType::String),
    FieldSpec::at(3, "difficultyId", FieldType::Integer),
    FieldSpec::at(4, "groupSize", FieldType::Integer),
    FieldSpec::opt_at(5, "instanceId", FieldType::Integer),
];
const ENCOUNTER_END_FIELDS: &[FieldSpec] = &[
    FieldSpec::at(1, "encounterId", FieldType::Integer),
    FieldSpec::at(2, "encounterName", FieldType::String),
    FieldSpec::at(3, "difficultyId", FieldType::Integer),
    FieldSpec::at(4, "groupSize", FieldType::Integer),
    FieldSpec::at(5, "success", FieldType::Bool),
    FieldSpec::opt_at(6, "durationMs", FieldType::Integer),
];
const MAP_CHANGE_FIELDS: &[FieldSpec] = &[
    FieldSpec::at(1, "uiMapId", FieldType::Integer),
    FieldSpec::at(2, "mapName", FieldType::String),
    FieldSpec::at(3, "maxX", FieldType::Float),
    FieldSpec::at(4, "minX", FieldType::Float),
    FieldSpec::at(5, "maxY", FieldType::Float),
    FieldSpec::at(6, "minY", FieldType::Float),
];
const STAGGER_CLEAR_FIELDS: &[FieldSpec] = &[
    FieldSpec::at(1, "playerGuid", FieldType::String),
    FieldSpec::at(2, "amount", FieldType::Float),
];
const UNIT_HEALTH_FIELDS: &[FieldSpec] = &[
    FieldSpec::at(1, "unitGuid", FieldType::String),
    FieldSpec::at(2, "currentHp", FieldType::Integer),
    FieldSpec::opt_at(3, "maxHp", FieldType::Integer),
];
const WORLD_MARKER_PLACED_FIELDS: &[FieldSpec] = &[
    FieldSpec::at(1, "instanceId", FieldType::Integer),
    FieldSpec::at(2, "markerIndex", FieldType::Integer),
    FieldSpec::at(3, "x", FieldType::Float),
    FieldSpec::at(4, "y", FieldType::Float),
];
const WORLD_MARKER_REMOVED_FIELDS: &[FieldSpec] = &[
    FieldSpec::at(1, "instanceId", FieldType::Integer),
    FieldSpec::at(2, "markerIndex", FieldType::Integer),
];
const ZONE_CHANGE_FIELDS: &[FieldSpec] = &[
    FieldSpec::at(1, "zoneId", FieldType::Integer),
    FieldSpec::at(2, "zoneName", FieldType::String),
    FieldSpec::at(3, "instanceType", FieldType::Integer),
];
const UNIT_DEATH_FIELDS: &[FieldSpec] = &[
    FieldSpec::opt("recapId", FieldType::Integer),
    FieldSpec::opt("unconsciousOnDeath", FieldType::BoolOrNil),
];
const ENCHANT_FIELDS: &[FieldSpec] = &[
    FieldSpec::req("spellName", FieldType::String),
    FieldSpec::req("itemId", FieldType::Integer),
    FieldSpec::req("itemName", FieldType::String),
];

pub fn metadata_fields(event_type: &str) -> &'static [FieldSpec] {
    match event_type {
        "ARENA_MATCH_START" => ARENA_MATCH_START_FIELDS,
        "ARENA_MATCH_END" => ARENA_MATCH_END_FIELDS,
        "CHALLENGE_MODE_START" => CHALLENGE_MODE_START_FIELDS,
        "CHALLENGE_MODE_END" => CHALLENGE_MODE_END_FIELDS,
        "COMBATANT_INFO" => COMBATANT_INFO_FIELDS,
        "EMOTE" => EMOTE_FIELDS,
        "ENCOUNTER_START" => ENCOUNTER_START_FIELDS,
        "ENCOUNTER_END" => ENCOUNTER_END_FIELDS,
        "MAP_CHANGE" => MAP_CHANGE_FIELDS,
        "STAGGER_CLEAR" => STAGGER_CLEAR_FIELDS,
        "UNIT_HEALTH" => UNIT_HEALTH_FIELDS,
        "WORLD_MARKER_PLACED" => WORLD_MARKER_PLACED_FIELDS,
        "WORLD_MARKER_REMOVED" => WORLD_MARKER_REMOVED_FIELDS,
        "ZONE_CHANGE" => ZONE_CHANGE_FIELDS,
        _ => &[],
    }
}

pub fn special_common_details(event_type: &str) -> Option<&'static [FieldSpec]> {
    match event_type {
        "ENCHANT_APPLIED" | "ENCHANT_REMOVED" => Some(ENCHANT_FIELDS),
        "UNIT_DIED" | "UNIT_DESTROYED" | "UNIT_DISSIPATES" => Some(UNIT_DEATH_FIELDS),
        _ => None,
    }
}

// Static suffix field groups (the dynamic ones — _DAMAGE / _HEAL — are built below).
const MISSED_FIELDS: &[FieldSpec] = &[
    FieldSpec::req("missType", FieldType::String),
    FieldSpec::opt("isOffHand", FieldType::BoolOrNil),
    FieldSpec::opt("amountMissed", FieldType::Integer),
    FieldSpec::opt("critical", FieldType::BoolOrNil),
];
const HEAL_ABSORBED_FIELDS: &[FieldSpec] = &[
    FieldSpec::req("extraGuid", FieldType::String),
    FieldSpec::req("extraName", FieldType::String),
    FieldSpec::req("extraFlags", FieldType::Hex),
    FieldSpec::req("extraRaidFlags", FieldType::Hex),
    FieldSpec::req("extraSpellId", FieldType::Integer),
    FieldSpec::req("extraSpellName", FieldType::String),
    FieldSpec::req("extraSchool", FieldType::SpellSchool),
    FieldSpec::req("absorbedAmount", FieldType::Integer),
    FieldSpec::opt("totalAmount", FieldType::Integer),
];
const ENERGIZE_FIELDS: &[FieldSpec] = &[
    FieldSpec::req("amount", FieldType::Integer),
    FieldSpec::opt("overEnergize", FieldType::Integer),
    FieldSpec::opt("powerType", FieldType::Integer),
    FieldSpec::opt("maxPower", FieldType::Integer),
];
const DRAIN_FIELDS: &[FieldSpec] = &[
    FieldSpec::req("amount", FieldType::Integer),
    FieldSpec::req("powerType", FieldType::Integer),
    FieldSpec::opt("extraAmount", FieldType::Integer),
    FieldSpec::opt("maxPower", FieldType::Integer),
];
const LEECH_FIELDS: &[FieldSpec] = &[
    FieldSpec::req("amount", FieldType::Integer),
    FieldSpec::req("powerType", FieldType::Integer),
    FieldSpec::opt("extraAmount", FieldType::Integer),
];
const EXTRA_SPELL_FIELDS: &[FieldSpec] = &[
    FieldSpec::req("extraSpellId", FieldType::Integer),
    FieldSpec::req("extraSpellName", FieldType::String),
    FieldSpec::req("extraSchool", FieldType::SpellSchool),
];
const EXTRA_SPELL_AURA_FIELDS: &[FieldSpec] = &[
    FieldSpec::req("extraSpellId", FieldType::Integer),
    FieldSpec::req("extraSpellName", FieldType::String),
    FieldSpec::req("extraSchool", FieldType::SpellSchool),
    FieldSpec::req("auraType", FieldType::String),
];
const EXTRA_ATTACKS_FIELDS: &[FieldSpec] = &[FieldSpec::req("amount", FieldType::Integer)];
const AURA_FIELDS: &[FieldSpec] = &[
    FieldSpec::req("auraType", FieldType::String),
    FieldSpec::opt("amount", FieldType::Integer),
];
const AURA_DOSE_FIELDS: &[FieldSpec] = &[
    FieldSpec::req("auraType", FieldType::String),
    FieldSpec::req("stacks", FieldType::Integer),
];
const CAST_FAILED_FIELDS: &[FieldSpec] = &[FieldSpec::req("failReason", FieldType::String)];
const INSTAKILL_FIELDS: &[FieldSpec] = &[FieldSpec::opt("unconsciousOnDeath", FieldType::BoolOrNil)];
const EMPOWER_FIELDS: &[FieldSpec] = &[FieldSpec::req("empoweredRank", FieldType::Integer)];
const DAMAGE_NONADV_FIELDS: &[FieldSpec] = &[
    FieldSpec::req("amount", FieldType::Integer),
    FieldSpec::req("overkill", FieldType::Integer),
    FieldSpec::req("school", FieldType::SpellSchool),
    FieldSpec::req("resisted", FieldType::Integer),
    FieldSpec::req("blocked", FieldType::Integer),
    FieldSpec::req("absorbed", FieldType::Integer),
    FieldSpec::req("critical", FieldType::BoolOrNil),
    FieldSpec::req("glancing", FieldType::BoolOrNil),
    FieldSpec::req("crushing", FieldType::BoolOrNil),
    FieldSpec::opt("isOffHand", FieldType::BoolOrNil),
];
const DAMAGE_ADV_HEAD: &[FieldSpec] = &[
    FieldSpec::req("baseAmount", FieldType::Integer),
    FieldSpec::req("rawAmount", FieldType::Integer),
    FieldSpec::req("overkill", FieldType::Integer),
    FieldSpec::req("school", FieldType::SpellSchool),
    FieldSpec::req("resisted", FieldType::Integer),
    FieldSpec::req("blocked", FieldType::Integer),
    FieldSpec::req("absorbed", FieldType::Integer),
    FieldSpec::req("critical", FieldType::BoolOrNil),
    FieldSpec::req("glancing", FieldType::BoolOrNil),
    FieldSpec::req("crushing", FieldType::BoolOrNil),
];
const HEAL_ADV_HEAD: &[FieldSpec] = &[
    FieldSpec::req("healedToHp", FieldType::Integer),
    FieldSpec::req("amount", FieldType::Integer),
    FieldSpec::req("overheal", FieldType::Integer),
    FieldSpec::req("absorbedToShield", FieldType::Integer),
    FieldSpec::req("critical", FieldType::BoolOrNil),
];
const HEAL_NONADV_FIELDS: &[FieldSpec] = &[
    FieldSpec::req("amount", FieldType::Integer),
    FieldSpec::req("overhealing", FieldType::Integer),
    FieldSpec::req("absorbed", FieldType::Integer),
    FieldSpec::req("critical", FieldType::BoolOrNil),
];

/// Fill `out` (cleared first) with the suffix field specs for an event. Reuses the
/// caller's buffer so no per-event Vec is allocated on the hot path.
pub fn suffix_fields_into(
    out: &mut Vec<FieldSpec>,
    suffix: Option<&str>,
    advanced: bool,
    support: bool,
    prefix: Option<&str>,
) {
    out.clear();
    let Some(suffix) = suffix else {
        return;
    };

    if suffix == "_DAMAGE" && prefix == Some("ENVIRONMENTAL") {
        out.push(FieldSpec::req("environmentalType", FieldType::String));
        damage_fields_into(out, advanced, support, false);
        return;
    }

    match suffix {
        "_DAMAGE" => damage_fields_into(out, advanced, support, true),
        // SWING_DAMAGE_LANDED shares the damage suffix but omits the trailing abilityHint,
        // so allow_ability_hint=false keeps that field optional (its absence is not an error).
        "_DAMAGE_LANDED" => damage_fields_into(out, advanced, support, false),
        "_MISSED" => out.extend_from_slice(MISSED_FIELDS),
        "_HEAL" => heal_fields_into(out, advanced, support),
        "_HEAL_ABSORBED" => out.extend_from_slice(HEAL_ABSORBED_FIELDS),
        "_ENERGIZE" => out.extend_from_slice(ENERGIZE_FIELDS),
        "_DRAIN" => out.extend_from_slice(DRAIN_FIELDS),
        "_LEECH" => out.extend_from_slice(LEECH_FIELDS),
        "_INTERRUPT" => out.extend_from_slice(EXTRA_SPELL_FIELDS),
        "_DISPEL" | "_STOLEN" => out.extend_from_slice(EXTRA_SPELL_AURA_FIELDS),
        "_DISPEL_FAILED" => out.extend_from_slice(EXTRA_SPELL_FIELDS),
        "_EXTRA_ATTACKS" => out.extend_from_slice(EXTRA_ATTACKS_FIELDS),
        "_AURA_APPLIED" | "_AURA_REMOVED" | "_AURA_REFRESH" | "_AURA_BROKEN" => {
            out.extend_from_slice(AURA_FIELDS)
        }
        "_AURA_APPLIED_DOSE" | "_AURA_REMOVED_DOSE" => out.extend_from_slice(AURA_DOSE_FIELDS),
        "_AURA_BROKEN_SPELL" => out.extend_from_slice(EXTRA_SPELL_AURA_FIELDS),
        "_CAST_FAILED" => out.extend_from_slice(CAST_FAILED_FIELDS),
        "_INSTAKILL" => out.extend_from_slice(INSTAKILL_FIELDS),
        "_EMPOWER_END" | "_EMPOWER_INTERRUPT" => out.extend_from_slice(EMPOWER_FIELDS),
        _ => {}
    }
}

/// Vec-returning wrapper retained for the reference/test path.
pub fn suffix_fields(
    suffix: Option<&str>,
    advanced: bool,
    support: bool,
    prefix: Option<&str>,
) -> Vec<FieldSpec> {
    let mut out = Vec::new();
    suffix_fields_into(&mut out, suffix, advanced, support, prefix);
    out
}

fn damage_fields_into(out: &mut Vec<FieldSpec>, advanced: bool, support: bool, allow_ability_hint: bool) {
    if advanced {
        out.extend_from_slice(DAMAGE_ADV_HEAD);
        out.push(FieldSpec {
            name: if support {
                "supportPlayerGuid"
            } else {
                "abilityHint"
            },
            field_type: FieldType::String,
            optional: !support && !allow_ability_hint,
            offset: None,
        });
    } else {
        out.extend_from_slice(DAMAGE_NONADV_FIELDS);
    }
}

fn heal_fields_into(out: &mut Vec<FieldSpec>, advanced: bool, support: bool) {
    if advanced {
        out.extend_from_slice(HEAL_ADV_HEAD);
        if support {
            out.push(FieldSpec::req("supportPlayerGuid", FieldType::String));
        }
    } else {
        out.extend_from_slice(HEAL_NONADV_FIELDS);
    }
}
