//! Scalar value parsers — ported VERBATIM from the ground-truth lib.rs.
//! Pure functions, no output-sink dependency. Do not "improve" these: their exact
//! behavior is what the differential test pins.

pub const MAX_SAFE_INTEGER: i64 = 9_007_199_254_740_991;

pub fn parse_integer(value: &str) -> Option<i64> {
    if value.is_empty() {
        return None;
    }
    let rest = value.strip_prefix('-').unwrap_or(value);
    if rest.is_empty() || !rest.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    value.parse::<i64>().ok()
}

pub fn parse_hex(value: &str) -> Option<i64> {
    let normalized = value
        .strip_prefix("0x")
        .or_else(|| value.strip_prefix("0X"))
        .unwrap_or(value);
    if normalized.is_empty() || !is_hex(normalized) {
        return None;
    }
    i64::from_str_radix(normalized, 16).ok()
}

pub fn parse_hex_or_integer(value: Option<&str>) -> Option<i64> {
    let value = value?;
    if value.starts_with("0x") || value.starts_with("0X") {
        parse_hex(value)
    } else {
        parse_integer(value)
    }
}

pub fn parse_boolean(value: &str) -> Option<bool> {
    if value == "1" || value.eq_ignore_ascii_case("true") {
        return Some(true);
    }
    if value == "0" || value.eq_ignore_ascii_case("false") {
        return Some(false);
    }
    None
}

pub fn looks_like_float(value: &str) -> bool {
    let Some((left, right)) = value.split_once('.') else {
        return false;
    };
    let left_digits = left.strip_prefix('-').unwrap_or(left);
    !left_digits.is_empty()
        && !right.is_empty()
        && left_digits.chars().all(|char| char.is_ascii_digit())
        && right.chars().all(|char| char.is_ascii_digit())
}

pub fn is_hex(value: &str) -> bool {
    value.chars().all(|char| char.is_ascii_hexdigit())
}

pub fn to_hex(value: i64) -> String {
    format!("0x{:x}", value)
}

pub fn to_camel_case(value: &str) -> String {
    let mut output = String::new();
    let mut uppercase_next = false;
    for char in value.chars() {
        if char == '_' {
            uppercase_next = true;
            continue;
        }
        if uppercase_next {
            output.extend(char.to_uppercase());
            uppercase_next = false;
        } else {
            output.push(char);
        }
    }
    output
}
