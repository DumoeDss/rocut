#[path = "flame_wrap/catalog.rs"]
mod catalog;
#[path = "flame_wrap/clock.rs"]
mod clock;
#[path = "flame_wrap/gpu_pipeline.rs"]
pub(crate) mod gpu_pipeline;
#[path = "flame_wrap/model.rs"]
pub(crate) mod model;
#[path = "flame_wrap/uniforms.rs"]
mod uniforms;

#[cfg(test)]
#[path = "flame_wrap/tests.rs"]
mod tests;

use serde_json::{Value, json};
use std::collections::BTreeMap;
use time::{FrameRate, MediaTime};

pub(crate) use catalog::definition;
pub(crate) use uniforms::pack_uniforms;

pub(crate) fn resolve(
    params: &BTreeMap<String, f64>,
    local_time: i64,
    rate: FrameRate,
) -> Result<Value, String> {
    if local_time.unsigned_abs() > 9_007_199_254_740_991 {
        return Err("Flame Wrap time must be safe integer ticks".into());
    }
    let frame = MediaTime::from_ticks(local_time)
        .to_frame_floor(rate)
        .filter(|_| rate.numerator <= 120_000 && rate.denominator <= 1001)
        .ok_or("Flame Wrap frame rate must have bounded integral ticks/frame")?;
    let ticks = MediaTime::from_frame(frame, rate)
        .ok_or("Flame Wrap frame tick overflow")?
        .as_ticks();
    let fields = definition().fields;
    for key in params.keys() {
        if !fields.iter().any(|field| field.key == key) {
            return Err(format!("Unknown Flame Wrap parameter {key}"));
        }
    }
    let mut values = BTreeMap::new();
    for field in fields {
        let value = params.get(field.key).copied().unwrap_or(field.default);
        if !value.is_finite()
            || !(field.min..=field.max).contains(&value)
            || (field.key == "seed" && value.fract() != 0.0)
        {
            return Err(format!("Invalid Flame Wrap parameter {}", field.key));
        }
        values.insert(field.key, value);
    }
    values.insert("phase", f64::from(clock::phase(ticks, values["speed"])));
    let neutral = values["amount"] == 0.0
        || ["flameOpacity", "sparkOpacity", "refraction"]
            .iter()
            .all(|key| values[key] == 0.0);
    Ok(
        json!({"version": 1, "frameIndex": frame, "passes": if neutral { vec![] } else { vec![json!({"shader": "flame_wrap", "uniforms": values})] }}),
    )
}
