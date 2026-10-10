mod catalog;
mod params;
mod trajectory;
mod uniforms;

#[cfg(test)]
mod tests;
#[cfg(test)]
mod uniform_tests;
#[cfg(test)]
mod shader_numerics_tests;

use std::collections::BTreeMap;

use serde_json::{Value, json};
use time::{FrameRate, MediaTime};

pub(crate) use catalog::definition;
pub(crate) use uniforms::{pack_uniforms, validate_device_dimensions};

/// Validates an immutable authored schedule and optical inputs without sampling.
/// Disabled and zero-strength callers still use this full admission check.
pub fn validate_bubble_schedule(params: &BTreeMap<String, f64>) -> Result<(), String> {
    params::prepare(params).map(|_| ())
}

pub(crate) fn resolve(
    params: &BTreeMap<String, f64>,
    local_time: i64,
    rate: FrameRate,
) -> Result<Value, String> {
    let prepared = params::prepare(params)?;
    if local_time.unsigned_abs() > trajectory::MAX_SAFE_TICKS {
        return Err("Bubble local time must be safe integer ticks".into());
    }
    let frame = MediaTime::from_ticks(local_time)
        .to_frame_floor(rate)
        .filter(|_| rate.numerator <= 120_000 && rate.denominator <= 1001)
        .ok_or("Bubble frame rate must have bounded integral ticks/frame")?;
    let sampled = MediaTime::from_frame(frame, rate)
        .ok_or("Bubble frame tick overflow")?
        .as_ticks();
    let elapsed = i128::from(sampled) - i128::from(prepared.start_ticks);
    // Flooring a negative safe input can produce a tick just below -MAX_SAFE.
    // It is nevertheless outside activity, so do not pass it to the trajectory.
    if elapsed < 0 || elapsed >= i128::from(prepared.duration_ticks) || prepared.neutral() {
        return Ok(json!({"version": 1, "frameIndex": frame, "passes": []}));
    }
    let sample = prepared
        .trajectory
        .sample(sampled)
        .map_err(|error| format!("Invalid Bubble sample: {error:?}"))?
        .ok_or("Bubble trajectory activity did not match its validated schedule")?;
    let phase = (prepared.speed * sample.elapsed_ticks as f64 / trajectory::TICKS_PER_SECOND as f64)
        .fract() as f32;
    let mut uniforms = prepared.optics;
    // The GPU phase is periodic; a rounded upper endpoint is the next cycle.
    uniforms.insert(
        "phase".into(),
        if phase >= 1.0 { 0.0 } else { f64::from(phase) },
    );
    uniforms.insert("ballCount".into(), sample.centers.len() as f64);
    for (index, center) in sample.centers.iter().enumerate() {
        for (axis, key) in uniforms::CENTER_KEYS[index].iter().enumerate() {
            uniforms.insert((*key).into(), center[axis]);
        }
    }
    Ok(json!({"version": 1, "frameIndex": frame,
        "passes": [{"shader": "bubble", "uniforms": uniforms}]}))
}
