//! Bounded volume-only subset of native audioAutomation.js normalization.
//! Other lane targets are rejected, not erased before graph admission.
use super::facts::seconds;
use super::fx_numbers::{clamp_number, number_string, replace_overflow_numbers};
use crate::programmatic_audio::envelope::{GainEnvelope, Point};
use serde_json::Value;

pub(super) fn max_gain() -> f64 {
    10.0_f64.powf(12.0 / 20.0)
}

fn number(value: &Value) -> Option<f64> {
    match value {
        Value::Number(value) => value.as_f64().filter(|value| value.is_finite()),
        Value::String(value) => number_string(value).filter(|value| value.is_finite()),
        _ => None,
    }
}

fn point(value: &Value) -> Option<Point> {
    let t = clamp_number(number(&value["t"])?, 0.0, f64::MAX);
    let v = clamp_number(number(&value["v"])?, 0.0, max_gain());
    let curve = number(&value["curve"])
        .map(|value| value.clamp(-1.0, 1.0))
        .filter(|value| *value != 0.0);
    let via = number(&value["viaX"])
        .zip(number(&value["viaY"]))
        .map(|(x, y)| (x.clamp(0.001, 0.999), y.clamp(0.001, 0.999)))
        .filter(|(x, y)| (x - y).abs() >= 1e-6);
    Some(Point {
        t,
        v,
        curve,
        via_x: via.map(|v| v.0),
        via_y: via.map(|v| v.1),
    })
}

pub(super) fn parse_volume_lane(raw: Option<&str>) -> Result<Option<Vec<Point>>, String> {
    let Some(raw) = raw.filter(|raw| !raw.is_empty()) else {
        return Ok(None);
    };
    if raw.len() > 128 * 1024 {
        return Err("HyperFrames automation exceeds the byte safety limit".into());
    }
    let value: Value = serde_json::from_str(&replace_overflow_numbers(raw))
        .map_err(|error| format!("Invalid HyperFrames automation JSON: {error}"))?;
    if value["version"].as_f64() != Some(1.0) {
        return Err("Unsupported HyperFrames automation version".into());
    }
    let lanes = value["lanes"]
        .as_array()
        .ok_or("Invalid HyperFrames automation lanes")?;
    if lanes.len() > 32 {
        return Err("HyperFrames automation exceeds the lane limit".into());
    }
    let mut first = None;
    let mut total = 0usize;
    for lane in lanes {
        // Do not silently drop unsupported/orphan FX/rate lanes even when native
        // normalization would ignore them. Execution has no such DSP/clock yet.
        if lane["target"].as_str() != Some("volume") {
            return Err(
                "HyperFrames automation target is not supported: only volume is executable".into(),
            );
        }
        let raw_points = lane["points"]
            .as_array()
            .ok_or("Invalid HyperFrames automation points")?;
        total += raw_points.len();
        if total > 4096 {
            return Err("HyperFrames automation exceeds the raw point limit".into());
        }
        let mut points: Vec<Point> = raw_points.iter().filter_map(point).collect();
        if points.iter().any(|point| !seconds(point.t)) {
            return Err("HyperFrames automation point time exceeds the safety limit".into());
        }
        points.sort_by(|a, b| a.t.total_cmp(&b.t));
        let mut normalized: Vec<Point> = Vec::with_capacity(points.len());
        for point in points {
            if normalized.last().is_some_and(|last| last.t == point.t) {
                normalized.pop();
            }
            normalized.push(point);
        }
        // Native normalization itself retains the first 512 normalized points.
        normalized.truncate(512);
        if first.is_none() && !normalized.is_empty() {
            first = Some(normalized);
        }
    }
    Ok(first)
}

pub(super) fn envelope(points: Vec<Point>, duration: f64, base_gain: f64) -> GainEnvelope {
    GainEnvelope {
        version: 1,
        start: 0.0,
        duration,
        base_gain,
        fade_in: 0.0,
        fade_out: 0.0,
        points,
    }
}

pub(super) fn validate_points(points: &[Point], duration: f64) -> Result<(), String> {
    let env = envelope(points.to_vec(), duration.max(1e-9), 1.0);
    env.validate()?;
    if points.iter().any(|point| point.v > max_gain()) {
        return Err("HyperFrames normalized volume exceeds the native ceiling".into());
    }
    Ok(())
}
