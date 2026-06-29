//! Timestamp/payload splitting — ported VERBATIM from the ground-truth lib.rs.
//! Returns a borrowed payload slice (zero-copy) and an optional parsed `Timestamp`.

use super::timestamp::{parse_timestamp, Timestamp};

pub struct LineParts<'a> {
    pub timestamp: Option<Timestamp>,
    pub payload: &'a str,
}

pub fn split_timestamp_and_payload(line: &str) -> Result<LineParts<'_>, String> {
    if starts_with_event_type(line) {
        return Ok(LineParts { timestamp: None, payload: line });
    }

    let bytes = line.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'\t' {
            let timestamp = &line[..index];
            let mut payload_start = index;
            while payload_start < bytes.len() && bytes[payload_start] == b'\t' {
                payload_start += 1;
            }
            return Ok(LineParts {
                timestamp: Some(parse_timestamp(timestamp)?),
                payload: &line[payload_start..],
            });
        }

        if bytes[index] == b' ' {
            let start = index;
            while index < bytes.len() && bytes[index] == b' ' {
                index += 1;
            }
            if index - start >= 2 {
                return Ok(LineParts {
                    timestamp: Some(parse_timestamp(&line[..start])?),
                    payload: &line[index..],
                });
            }
            continue;
        }

        index += 1;
    }

    Err("Line does not match WoW combat log timestamp/event format".to_string())
}

pub fn starts_with_event_type(line: &str) -> bool {
    let mut chars = line.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    if !first.is_ascii_uppercase() {
        return false;
    }

    for char in chars {
        if char == ',' {
            return true;
        }
        if !(char.is_ascii_uppercase() || char.is_ascii_digit() || char == '_') {
            return false;
        }
    }
    false
}
