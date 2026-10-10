mod catalog;
mod clock;
mod field;
mod uniforms;

#[cfg(test)]
mod tests;
#[cfg(test)]
mod uniform_tests;

use std::collections::BTreeMap;

use serde_json::{Value, json};
use time::{FrameRate, MediaTime};

pub(crate) use catalog::definition;
pub(crate) use uniforms::pack_uniforms;

pub(crate) fn resolve(
    params: &BTreeMap<String, f64>,
    local_time: i64,
    rate: FrameRate,
) -> Result<Value, String> {
    if local_time.unsigned_abs() > 9_007_199_254_740_991 {
        return Err("Blaze time must be safe integer ticks".into());
    }
    let frame = MediaTime::from_ticks(local_time)
        .to_frame_floor(rate)
        .filter(|_| rate.numerator <= 120_000 && rate.denominator <= 1001)
        .ok_or("Blaze frame rate must have bounded integral ticks/frame")?;
    let sample_ticks = MediaTime::from_frame(frame, rate)
        .ok_or("Blaze frame tick overflow")?
        .as_ticks();
    let fields = definition().fields;
    for key in params.keys() {
        if !fields.iter().any(|field| field.key == key) {
            return Err(format!("Unknown Blaze parameter {key}"));
        }
    }
    let mut uniforms = BTreeMap::new();
    for field in fields {
        let value = params.get(field.key).copied().unwrap_or(field.default);
        if !value.is_finite()
            || !(field.min..=field.max).contains(&value)
            || (field.key == "seed" && value.fract() != 0.0)
        {
            return Err(format!("Invalid Blaze parameter {}", field.key));
        }
        uniforms.insert(field.key, value);
    }
    uniforms.insert(
        "phase",
        f64::from(clock::phase(sample_ticks, uniforms["speed"])),
    );
    let neutral = uniforms["amount"] == 0.0
        || ["flameOpacity", "sparkOpacity", "smokeOpacity", "refraction"]
            .iter()
            .all(|key| uniforms[key] == 0.0);
    let passes = if neutral {
        vec![]
    } else {
        vec![json!({"shader": "blaze", "uniforms": uniforms})]
    };
    Ok(json!({"version": 1, "frameIndex": frame, "passes": passes}))
}
