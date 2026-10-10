mod catalog;
mod params;
#[cfg(test)]
mod shader_tests;
mod strokes;
#[cfg(test)]
mod tests;
#[cfg(test)]
mod uniform_tests;
mod uniforms;

use serde_json::{Value, json};
use std::collections::BTreeMap;
use time::{FrameRate, MediaTime};

pub(crate) use catalog::definition;
pub use strokes::{MAX_FROST_STROKES, MAX_FROST_TICKS};
pub(crate) use uniforms::pack_uniforms;

/// Admission is complete even for a neutral or out-of-activity request.
pub fn validate_frost_schedule(params: &BTreeMap<String, f64>) -> Result<(), String> {
    params::prepare(params).map(|_| ())
}

pub(crate) fn resolve(
    params: &BTreeMap<String, f64>,
    local_time: i64,
    rate: FrameRate,
) -> Result<Value, String> {
    let prepared = params::prepare(params)?;
    if local_time.unsigned_abs() > MAX_FROST_TICKS {
        return Err("Frost local time must be safe integer ticks".into());
    }
    let frame = MediaTime::from_ticks(local_time)
        .to_frame_floor(rate)
        .filter(|_| rate.numerator <= 120_000 && rate.denominator <= 1001)
        .ok_or("Frost frame rate must have bounded integral ticks/frame")?;
    let sampled = MediaTime::from_frame(frame, rate)
        .ok_or("Frost frame tick overflow")?
        .as_ticks();
    if sampled < 0 || prepared.neutral() {
        return Ok(json!({"version":1,"frameIndex":frame,"passes":[]}));
    }
    let mut values = prepared.optics;
    let mut active = 0;
    for stroke in prepared.strokes {
        let strength = stroke.strength_at(sampled, prepared.hold, prepared.recovery);
        if strength == 0.0 {
            continue;
        }
        let keys = catalog::STROKE_KEYS[active];
        for (key, value) in keys[1..].iter().zip([
            stroke.from[0],
            stroke.from[1],
            stroke.to[0],
            stroke.to[1],
            stroke.radius,
            strength,
        ]) {
            values.insert((*key).into(), value);
        }
        active += 1;
    }
    values.insert("strokeCount".into(), active as f64);
    Ok(json!({"version":1,"frameIndex":frame,"passes":[{"shader":"frost","uniforms":values}]}))
}
