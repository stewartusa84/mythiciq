//! Timestamp parsing — ported VERBATIM from the ground-truth lib.rs. Only the sink
//! changes: the structured fields land in a plain `Timestamp` struct instead of a
//! `serde_json::Map`, and `epoch_ms` mirrors the old `timestamp_value_to_epoch_ms`.

use super::scalars::parse_integer;

#[derive(Clone, Debug, Default)]
pub struct Timestamp {
    pub raw: String,
    pub month: i64,
    pub day: i64,
    pub year: Option<i64>,
    pub hour: i64,
    pub minute: i64,
    pub second: i64,
    pub millisecond: i64,
    pub timezone_offset_minutes: Option<i64>,
}

pub fn parse_timestamp(raw: &str) -> Result<Timestamp, String> {
    let mut parts = raw.split_whitespace();
    let date = parts
        .next()
        .ok_or_else(|| format!("Invalid timestamp: {raw}"))?;
    let time = parts
        .next()
        .ok_or_else(|| format!("Invalid timestamp: {raw}"))?;
    if parts.next().is_some() {
        return Err(format!("Invalid timestamp: {raw}"));
    }

    let date_parts = date.split('/').collect::<Vec<_>>();
    if date_parts.len() != 2 && date_parts.len() != 3 {
        return Err(format!("Invalid timestamp: {raw}"));
    }
    let month = parse_required_i64(date_parts[0], raw)?;
    let day = parse_required_i64(date_parts[1], raw)?;
    let year = if date_parts.len() == 3 {
        let year = parse_required_i64(date_parts[2], raw)?;
        Some(if year < 100 { 2000 + year } else { year })
    } else {
        None
    };

    let offset_index = time
        .char_indices()
        .skip(1)
        .find_map(|(index, char)| (char == '+' || char == '-').then_some(index));
    let (time_body, offset) = if let Some(index) = offset_index {
        (&time[..index], Some(&time[index..]))
    } else {
        (time, None)
    };

    let time_parts = time_body.split(':').collect::<Vec<_>>();
    if time_parts.len() != 3 {
        return Err(format!("Invalid timestamp: {raw}"));
    }
    let hour = parse_required_i64(time_parts[0], raw)?;
    let minute = parse_required_i64(time_parts[1], raw)?;
    let (second_raw, fraction_raw) = match time_parts[2].split_once('.') {
        Some((second, fraction)) => (second, Some(fraction)),
        None => (time_parts[2], None),
    };
    let second = parse_required_i64(second_raw, raw)?;
    let millisecond = fraction_raw.map(milliseconds_from_fraction).unwrap_or(0);
    let timezone_offset_minutes = offset.map(parse_timezone_offset).transpose()?;

    Ok(Timestamp {
        raw: raw.to_string(),
        month,
        day,
        year,
        hour,
        minute,
        second,
        millisecond,
        timezone_offset_minutes,
    })
}

fn parse_required_i64(value: &str, raw_timestamp: &str) -> Result<i64, String> {
    parse_integer(value).ok_or_else(|| format!("Invalid timestamp: {raw_timestamp}"))
}

fn milliseconds_from_fraction(raw: &str) -> i64 {
    let b = raw.as_bytes();
    let d = |i: usize| {
        b.get(i)
            .copied()
            .filter(u8::is_ascii_digit)
            .map(|c| (c - b'0') as i64)
            .unwrap_or(0)
    };
    d(0) * 100 + d(1) * 10 + d(2)
}

fn parse_timezone_offset(raw: &str) -> Result<i64, String> {
    let sign = if raw.starts_with('-') { -1 } else { 1 };
    let body = &raw[1..];
    if let Some((hours, minutes)) = body.split_once(':') {
        return Ok(
            sign * (parse_integer(hours).unwrap_or(0) * 60 + parse_integer(minutes).unwrap_or(0)),
        );
    }
    if body.len() > 2 {
        let split = body.len() - 2;
        return Ok(sign
            * (parse_integer(&body[..split]).unwrap_or(0) * 60
                + parse_integer(&body[split..]).unwrap_or(0)));
    }
    Ok(sign * parse_integer(body).unwrap_or(0) * 60)
}

/// Epoch milliseconds, mirroring the old `timestamp_value_to_epoch_ms`. Returns
/// `None` when the date lacks a year (the only case the old path couldn't resolve).
pub fn epoch_ms(ts: &Timestamp) -> Option<f64> {
    let year = ts.year?;
    let days = days_from_civil(year, ts.month, ts.day)?;
    let day_ms = days.checked_mul(86_400_000)?;
    let time_ms = ts
        .hour
        .checked_mul(3_600_000)?
        .checked_add(ts.minute.checked_mul(60_000)?)?
        .checked_add(ts.second.checked_mul(1_000)?)?
        .checked_add(ts.millisecond)?;
    let offset_ms = ts.timezone_offset_minutes.unwrap_or(0).checked_mul(60_000)?;
    Some((day_ms.checked_add(time_ms)?.checked_sub(offset_ms)?) as f64)
}

pub fn days_from_civil(year: i64, month: i64, day: i64) -> Option<i64> {
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }
    let adjusted_year = year - if month <= 2 { 1 } else { 0 };
    let era = if adjusted_year >= 0 {
        adjusted_year
    } else {
        adjusted_year - 399
    } / 400;
    let year_of_era = adjusted_year - era * 400;
    let adjusted_month = month + if month > 2 { -3 } else { 9 };
    let day_of_year = (153 * adjusted_month + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    Some(era * 146_097 + day_of_era - 719_468)
}
