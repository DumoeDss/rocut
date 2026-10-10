use serde_json::{Value, json};
use std::collections::BTreeMap;
use time::{FrameRate, MediaTime};

/// Strict complete schedule admission, including neutral or pre-activity requests.
pub fn validate_canvas_schedule(params: &BTreeMap<String, f64>) -> Result<(), String> {
    super::parse(params)
        .map(|_| ())
        .map_err(|error| error.to_string())
}

/// Transport-only resolver. The f64 payload is losslessly encoded through the
/// shared f32 Vector transport.
/// The runtime must decode/admit it before preparing material state.
pub(crate) fn resolve(
    params: &BTreeMap<String, f64>,
    local_time: i64,
    rate: FrameRate,
) -> Result<Value, String> {
    super::parse(params).map_err(|error| error.to_string())?;
    let sampled = super::frame_floor(local_time, rate.numerator, rate.denominator)
        .map_err(|error| error.to_string())?;
    let frame = MediaTime::from_ticks(sampled)
        .to_frame_floor(rate)
        .ok_or("Canvas shared frame evaluation failed")?;
    if sampled < 0 {
        return Ok(json!({"version":1,"frameIndex":frame,"passes":[]}));
    }
    let mut uniforms: BTreeMap<_, _> = params
        .iter()
        .map(|(key, value)| (key.clone(), super::pass::encode(*value)))
        .collect();
    uniforms.insert("sampledTicks".into(), super::pass::encode(sampled as f64));
    Ok(json!({"version":1,"frameIndex":frame,
        "passes":[{"shader":"canvas","uniforms":uniforms}]}))
}
