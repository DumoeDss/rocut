mod catalog;
mod geometry;
mod uniforms;

#[cfg(test)]
mod tests;

use std::collections::BTreeMap;

use serde_json::{Value, json};
use time::{FrameRate, MediaTime};

pub(crate) use catalog::definition;
pub(crate) use uniforms::pack_uniforms;

pub(crate) const MAX_DROPLETS: usize = 64;
const MAX_SAFE_TICKS: u64 = 9_007_199_254_740_991;

pub(crate) fn resolve(
    params: &BTreeMap<String, f64>,
    local_time: i64,
    rate: FrameRate,
) -> Result<Value, String> {
    if local_time.unsigned_abs() > MAX_SAFE_TICKS {
        return Err("Droplets time must be safe integer ticks".into());
    }
    let frame = MediaTime::from_ticks(local_time)
        .to_frame_floor(rate)
        .filter(|_| rate.numerator <= 120_000 && rate.denominator <= 1001)
        .ok_or("Droplets frame rate must have bounded integral ticks/frame")?;
    let sample_ticks = MediaTime::from_frame(frame, rate)
        .ok_or("Droplets frame tick overflow")?
        .as_ticks();
    let fields = definition().fields;
    for key in params.keys() {
        if !fields.iter().any(|field| field.key == key) {
            return Err(format!("Unknown Droplets parameter {key}"));
        }
    }
    let mut uniforms = BTreeMap::new();
    for field in fields {
        let value = params.get(field.key).copied().unwrap_or(field.default);
        if !value.is_finite()
            || !(field.min..=field.max).contains(&value)
            || (matches!(field.key, "count" | "seed") && value.fract() != 0.0)
        {
            return Err(format!("Invalid Droplets parameter {}", field.key));
        }
        uniforms.insert(field.key, value);
    }
    // A bounded phase is the only clock transported to the GPU. Canonicalize
    // the rounded cycle endpoint before the f32 raw-uniform boundary.
    let phase = geometry::time_phase(sample_ticks, uniforms["speed"]) as f32;
    uniforms.insert("phase", if phase >= 1.0 { 0.0 } else { phase as f64 });
    let passes = if uniforms["amount"] == 0.0 || uniforms["count"] == 0.0 {
        vec![]
    } else {
        vec![json!({"shader": "droplets", "uniforms": uniforms})]
    };
    Ok(json!({"version": 1, "frameIndex": frame, "passes": passes}))
}
