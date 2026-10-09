use std::collections::BTreeMap;

use serde_json::{Value, json};
use time::{FrameRate, MediaTime, TICKS_PER_SECOND};

use crate::wave_catalog::{EVENT_KEYS, MAX_EVENT_TICKS, MAX_WAVE_EVENTS, global_fields};

pub fn validate_wave_schedule(params: &BTreeMap<String, f64>) -> Result<usize, String> {
    let count = params.get("eventCount").copied().unwrap_or(0.0);
    if !count.is_finite()
        || !(0.0..=MAX_WAVE_EVENTS as f64).contains(&count)
        || count.fract() != 0.0
    {
        return Err(format!(
            "Wave eventCount must be an integer from 0 to {MAX_WAVE_EVENTS}"
        ));
    }
    for (index, keys) in EVENT_KEYS.iter().enumerate() {
        for (component, key) in keys.iter().enumerate() {
            let Some(value) = params.get(*key).copied() else {
                if index < count as usize {
                    return Err(format!("Active wave impact {index} requires {key}"));
                }
                continue;
            };
            let valid = value.is_finite()
                && match component {
                    0 => (0.0..=MAX_EVENT_TICKS).contains(&value) && value.fract() == 0.0,
                    1 | 2 => (-1.0..=2.0).contains(&value),
                    _ => (-1.0..=1.0).contains(&value),
                };
            if !valid {
                return Err(format!("Invalid wave schedule field {key}"));
            }
        }
    }
    if let Some(key) = params.keys().find(|key| {
        key.starts_with("event")
            && key.as_str() != "eventCount"
            && !EVENT_KEYS
                .iter()
                .flatten()
                .any(|known| *known == key.as_str())
    }) {
        return Err(format!("Unknown wave schedule field {key}"));
    }
    Ok(count as usize)
}

pub(crate) fn resolve_wave_effect(
    effect_type: &str,
    params: &BTreeMap<String, f64>,
    local_time: i64,
    rate: FrameRate,
) -> Result<Value, String> {
    if !matches!(effect_type, "ripple" | "force-field") {
        return Err("Unknown wave effect".into());
    }
    if local_time.unsigned_abs() > MAX_EVENT_TICKS as u64 {
        return Err("Wave effect time must be safe integer ticks".into());
    }
    let frame = MediaTime::from_ticks(local_time)
        .to_frame_floor(rate)
        .filter(|_| rate.numerator <= 120_000 && rate.denominator <= 1001)
        .ok_or("Wave frame rate must have bounded integral ticks/frame")?;
    let sample_ticks = MediaTime::from_frame(frame, rate)
        .ok_or("Wave frame tick overflow")?
        .as_ticks();
    let count = validate_wave_schedule(params)?;
    let fields = global_fields(effect_type == "force-field");
    for key in params.keys() {
        if key != "eventCount"
            && !EVENT_KEYS
                .iter()
                .flatten()
                .any(|known| *known == key.as_str())
            && !fields.iter().any(|field| field.key == key)
        {
            return Err(format!("Unknown wave effect parameter {key}"));
        }
    }
    let mut uniforms = serde_json::Map::new();
    for field in fields {
        let raw = params.get(field.key).copied().unwrap_or(field.default);
        if !raw.is_finite() {
            return Err("Wave parameters must be finite".into());
        }
        uniforms.insert(field.key.into(), json!(raw.clamp(field.min, field.max)));
    }
    let lifetime = uniforms["lifetime"].as_f64().unwrap();
    let mut events = Vec::with_capacity(count * 4);
    let mut active = false;
    for keys in &EVENT_KEYS[..count] {
        let event_ticks = params[keys[0]] as i64;
        // Subtract exact integer ticks before any floating-point conversion.
        let age = (sample_ticks - event_ticks) as f64 / TICKS_PER_SECOND as f64;
        let amplitude = params[keys[3]];
        active |= age > 0.0 && age < lifetime && amplitude != 0.0;
        events.extend([
            params[keys[1]],
            params[keys[2]],
            age.clamp(-1.0, lifetime),
            amplitude,
        ]);
    }
    let amount = uniforms["amount"].as_f64().unwrap();
    uniforms.insert("eventCount".into(), json!(count));
    uniforms.insert("events".into(), json!(events));
    let passes = if amount == 0.0 || !active {
        vec![]
    } else {
        vec![json!({"shader":effect_type,"uniforms":uniforms})]
    };
    Ok(json!({"version":1,"frameIndex":frame,"passes":passes}))
}
