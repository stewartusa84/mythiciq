//! WoW-specific CSV tokenizer — ported from the ground-truth lib.rs, then tuned to
//! borrow instead of allocate.
//!
//! Handles quoted fields (with `""` escapes), `[...]` arrays and `(...)` nesting, so
//! commas inside names/arrays don't split. Fields point directly into the input
//! (`Cow::Borrowed`); the only allocation is when a quoted field actually contains a
//! `""` escape that must be rewritten — rare in practice.

use std::borrow::Cow;

#[derive(Clone, Debug)]
pub struct CsvField<'a> {
    /// `None` for an unquoted `nil`; otherwise the field's (unquoted, unescaped) text,
    /// borrowed from the input unless a `""` escape forced a rewrite.
    pub value: Option<Cow<'a, str>>,
}

/// Tokenize into a caller-provided buffer (cleared first) so the allocation can be
/// reused across millions of lines. All slices borrow from `input`.
pub fn split_wow_csv_into<'a>(input: &'a str, out: &mut Vec<CsvField<'a>>) -> Result<(), String> {
    out.clear();
    let bytes = input.as_bytes();
    let len = bytes.len();
    let mut index = 0;
    let mut field_start = 0usize;
    let mut in_quote = false;
    let mut quoted = false;
    let mut bracket_depth: i32 = 0;
    let mut paren_depth: i32 = 0;

    while index < len {
        let b = bytes[index];

        if in_quote {
            if b == b'"' {
                if index + 1 < len && bytes[index + 1] == b'"' {
                    index += 2;
                    continue;
                }
                in_quote = false;
                index += 1;
                continue;
            }
            index += 1;
            continue;
        }

        match b {
            b'"' => {
                quoted = true;
                in_quote = true;
            }
            b'[' if paren_depth == 0 => bracket_depth += 1,
            b']' if paren_depth == 0 && bracket_depth > 0 => bracket_depth -= 1,
            b'(' => paren_depth += 1,
            b')' if paren_depth > 0 => paren_depth -= 1,
            b',' if bracket_depth == 0 && paren_depth == 0 => {
                push_csv_field_slice(out, &input[field_start..index], quoted);
                quoted = false;
                field_start = index + 1;
                index += 1;
                continue;
            }
            _ => {}
        }
        index += 1;
    }

    if in_quote {
        return Err("Unterminated quoted field".to_string());
    }

    push_csv_field_slice(out, &input[field_start..], quoted);
    Ok(())
}

/// Convenience wrapper that allocates a fresh buffer (used by the reference/test path).
pub fn split_wow_csv(input: &str) -> Result<Vec<CsvField<'_>>, String> {
    let mut out = Vec::new();
    split_wow_csv_into(input, &mut out)?;
    Ok(out)
}

fn push_csv_field_slice<'a>(fields: &mut Vec<CsvField<'a>>, raw: &'a str, quoted: bool) {
    let value = if quoted {
        let inner = if raw.len() >= 2 {
            &raw[1..raw.len() - 1]
        } else {
            raw
        };
        if inner.contains("\"\"") {
            Some(Cow::Owned(inner.replace("\"\"", "\"")))
        } else {
            Some(Cow::Borrowed(inner))
        }
    } else {
        let trimmed = raw.trim();
        if trimmed == "nil" {
            None
        } else {
            Some(Cow::Borrowed(trimmed))
        }
    };

    fields.push(CsvField { value });
}
