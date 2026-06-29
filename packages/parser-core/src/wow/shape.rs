//! Event-shape inference — ported VERBATIM from the ground-truth lib.rs.
//! Determines prefix/suffix decomposition, advanced-block presence, and
//! source/target layout for each event type.

pub const ADVANCED_BLOCK_LEN: usize = 19;

pub struct EventShape<'a> {
    pub event_type: &'a str,
    pub base_event_type: &'a str,
    pub prefix: Option<&'static str>,
    pub suffix: Option<&'a str>,
    pub has_spell_prefix: bool,
    pub no_source_target: bool,
    pub support: bool,
}

pub fn infer_shape(event_type: &str) -> EventShape<'_> {
    let support = event_type.ends_with("_SUPPORT");
    let base_event_type = if support {
        event_type.trim_end_matches("_SUPPORT")
    } else {
        event_type
    };

    if let Some(suffix) = special_spell_event_suffix(base_event_type) {
        return EventShape {
            event_type,
            base_event_type,
            prefix: Some("SPELL"),
            suffix: Some(suffix),
            has_spell_prefix: true,
            no_source_target: false,
            support,
        };
    }

    let no_source_target = no_source_target_event(event_type);
    for prefix in [
        "SPELL_PERIODIC",
        "SPELL_BUILDING",
        "SPELL",
        "RANGE",
        "SWING",
        "ENVIRONMENTAL",
    ] {
        let after_prefix = base_event_type.get(prefix.len()..).unwrap_or("");
        if base_event_type.starts_with(prefix) && after_prefix.starts_with('_') {
            return EventShape {
                event_type,
                base_event_type,
                prefix: Some(prefix),
                suffix: Some(after_prefix),
                has_spell_prefix: matches!(
                    prefix,
                    "SPELL" | "SPELL_PERIODIC" | "SPELL_BUILDING" | "RANGE"
                ),
                no_source_target,
                support,
            };
        }
    }

    EventShape {
        event_type,
        base_event_type,
        prefix: None,
        suffix: None,
        has_spell_prefix: false,
        no_source_target,
        support,
    }
}

pub fn special_spell_event_suffix(event_type: &str) -> Option<&'static str> {
    match event_type {
        "DAMAGE_SHIELD" | "DAMAGE_SPLIT" => Some("_DAMAGE"),
        "DAMAGE_SHIELD_MISSED" => Some("_MISSED"),
        _ => None,
    }
}

pub fn no_source_target_event(event_type: &str) -> bool {
    matches!(
        event_type,
        "ARENA_MATCH_END"
            | "ARENA_MATCH_START"
            | "CHALLENGE_MODE_END"
            | "CHALLENGE_MODE_START"
            | "COMBAT_LOG_VERSION"
            | "COMBATANT_INFO"
            | "EMOTE"
            | "ENCOUNTER_END"
            | "ENCOUNTER_START"
            | "MAP_CHANGE"
            | "STAGGER_CLEAR"
            | "UNIT_HEALTH"
            | "WORLD_MARKER_PLACED"
            | "WORLD_MARKER_REMOVED"
            | "ZONE_CHANGE"
    )
}

pub fn min_required_suffix_fields_after_advanced(suffix: Option<&str>, support: bool) -> usize {
    match suffix {
        Some("_DAMAGE") => 11,
        // SWING_DAMAGE_LANDED carries the advanced damage suffix but WITHOUT the trailing
        // abilityHint that SPELL_DAMAGE has, so its minimum is the 10 head fields.
        Some("_DAMAGE_LANDED") => 10,
        Some("_HEAL") => {
            if support {
                6
            } else {
                5
            }
        }
        Some("_ENERGIZE") => 1,
        _ => 0,
    }
}

pub fn should_parse_advanced(field_count: usize, shape: &EventShape<'_>, advanced_start: usize) -> bool {
    if shape.no_source_target || advanced_start <= 1 {
        return false;
    }

    let minimum_after_advanced =
        min_required_suffix_fields_after_advanced(shape.suffix.as_deref(), shape.support);
    let has_room = field_count >= advanced_start + ADVANCED_BLOCK_LEN + minimum_after_advanced;
    if !has_room {
        return false;
    }

    if shape.prefix == Some("SWING")
        && matches!(shape.suffix.as_deref(), Some("_DAMAGE" | "_DAMAGE_LANDED"))
    {
        return true;
    }
    if shape.prefix == Some("ENVIRONMENTAL") && shape.suffix.as_deref() == Some("_DAMAGE") {
        return true;
    }
    if shape.has_spell_prefix
        && matches!(
            shape.suffix.as_deref(),
            Some("_DAMAGE" | "_HEAL" | "_ENERGIZE")
        )
    {
        return true;
    }

    shape.base_event_type == "SPELL_CAST_SUCCESS"
        && field_count >= advanced_start + ADVANCED_BLOCK_LEN
}

pub fn describe_advanced_block(shape: &EventShape<'_>) -> Option<&'static str> {
    if shape.base_event_type == "SWING_DAMAGE" {
        return Some("source");
    }
    if shape.base_event_type == "SWING_DAMAGE_LANDED" || shape.prefix == Some("ENVIRONMENTAL") {
        return Some("target");
    }
    if matches!(
        shape.suffix.as_deref(),
        Some("_DAMAGE" | "_HEAL" | "_ENERGIZE")
    ) {
        return Some("target");
    }
    None
}
