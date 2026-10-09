//! Bounded native FX automation admission, core 0.8.139 audioAutomation.js and
//! audio/audioFxAutomation.js. Values remain in authored KNOB units; the pinned
//! native scheduler owns logarithmic interpolation and AudioParam unit maps.
//! Adapted and modified from @hyperframes/core, Copyright 2026 HeyGen, Inc.,
//! Apache-2.0. Full license and modification notice: rust/wasm/NOTICE.
use super::facts::seconds;
use super::fx_automation_tail::tail_seconds;
use super::fx_automation_target::{Binding, bind};
use super::fx_model::FxChain;
use super::fx_numbers::{clamp_number, number_string, replace_overflow_numbers};
use crate::programmatic_audio::envelope::Point;
use serde::Serialize;
use serde_json::{Value, json};

const MAX_BYTES: usize = 128 * 1024;
const MAX_RAW_POINTS: usize = 4096;
const MAX_CURVE_VALUES: usize = 262144;

#[derive(Clone, Debug, Serialize)]
pub(super) struct Lane {
    pub target: String,
    pub points: Vec<Point>,
}

#[derive(Debug)]
pub(super) struct FxAutomationAdmission {
    pub fx_automation: Option<Value>,
    pub volume_automation: Option<String>,
    pub volume_points: Option<Vec<Point>>,
    pub rate_points: Option<Vec<Point>>,
    pub point_count: usize,
    pub expanded_curve_values: usize,
    pub scheduled_events: usize,
    pub tail_seconds: f64,
    /// Native-defined drops/no-ops are explicit, never an implied capability.
    pub diagnostics: Vec<String>,
}

fn bounds(value: &Value, depth: usize, count: &mut usize) -> Result<(), String> {
    *count += 1;
    if depth > 8 || *count > 32768 {
        return Err("HyperFrames automation exceeds the depth/value safety limit".into());
    }
    match value {
        Value::Object(object) => {
            if object.len() > 64 || object.keys().any(|key| key.len() > 4096) {
                return Err("HyperFrames automation exceeds the key safety limit".into());
            }
            for child in object.values() {
                bounds(child, depth + 1, count)?;
            }
        }
        Value::Array(array) => {
            for child in array {
                bounds(child, depth + 1, count)?;
            }
        }
        Value::String(string) if string.len() > 4096 => {
            return Err("HyperFrames automation exceeds the string safety limit".into());
        }
        _ => {}
    }
    Ok(())
}

fn number(value: &Value) -> Option<f64> {
    match value {
        Value::Number(value) => value.as_f64(),
        Value::String(value) => number_string(value),
        _ => None,
    }
    .filter(|value| value.is_finite())
}

fn point(value: &Value) -> Option<Point> {
    let t = clamp_number(number(&value["t"])?, 0.0, f64::MAX);
    let v = number(&value["v"])?;
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

fn normalize(raw: &[Value]) -> Result<Vec<Point>, String> {
    let mut points: Vec<_> = raw.iter().filter_map(point).collect();
    // Validate all clean raw points BEFORE native 512-point truncation, including
    // points beyond the output window or points later shadowed by a duplicate.
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
    normalized.truncate(512);
    Ok(normalized)
}

fn expansion(points: &[Point], binding: &Binding) -> (usize, usize) {
    if points.is_empty() {
        return (0, 0);
    }
    if points.iter().all(|point| point.v == points[0].v) {
        return (binding.mapped_targets.len(), 0);
    }
    let mut events = 0;
    let mut values = 0;
    for mapped in &binding.mapped_targets {
        let mut seeded_by_curve = false;
        for (i, pair) in points.windows(2).enumerate() {
            let a = &pair[0];
            let b = &pair[1];
            let curved = a.curve.is_some() || a.via_x.is_some() || binding.log_scale || *mapped;
            events += 1;
            if curved {
                values += ((b.t - a.t) * 100.0).ceil().clamp(8.0, 4096.0) as usize;
                if i == 0 && a.t == 0.0 {
                    seeded_by_curve = true;
                }
            }
        }
        if !seeded_by_curve {
            events += 1;
        }
    }
    (events, values)
}

/// Admission is independent of an output crop: canonical scheduling receives
/// every retained point. Duplicate lanes and IDs keep native order/semantics.
/// Orphans/enums drop exactly as native resolution does, with diagnostics;
/// disabled/unexposed knobs stay in FX JSON because they can still affect tail.
pub(super) fn admit_fx_automation(
    raw: Option<&str>,
    chain: &FxChain,
) -> Result<FxAutomationAdmission, String> {
    let mut lanes = Vec::<Lane>::new();
    let mut diagnostics = vec![];
    let mut expanded_curve_values = 0;
    let mut scheduled_events = 0;
    if let Some(raw) = raw.filter(|raw| !raw.is_empty()) {
        if raw.len() > MAX_BYTES {
            return Err("HyperFrames automation exceeds the byte safety limit".into());
        }
        let value: Value = serde_json::from_str(&replace_overflow_numbers(raw))
            .map_err(|error| format!("Invalid HyperFrames automation JSON: {error}"))?;
        bounds(&value, 0, &mut 0)?;
        if value["version"].as_f64() != Some(1.0) {
            return Err("Unsupported HyperFrames automation version".into());
        }
        let raw_lanes = value["lanes"]
            .as_array()
            .ok_or("Invalid HyperFrames automation lanes")?;
        if raw_lanes.len() > 32 {
            return Err("HyperFrames automation exceeds the lane limit".into());
        }
        let mut raw_point_count = 0;
        for raw_lane in raw_lanes {
            let target = raw_lane["target"]
                .as_str()
                .ok_or("Unreadable HyperFrames automation target")?;
            let binding = bind(target, chain)?;
            let raw_points = raw_lane["points"]
                .as_array()
                .ok_or("Invalid HyperFrames automation points")?;
            raw_point_count += raw_points.len();
            if raw_point_count > MAX_RAW_POINTS {
                return Err("HyperFrames automation exceeds the raw point limit".into());
            }
            let mut points = normalize(raw_points)?;
            let Some(binding) = binding else {
                diagnostics.push(format!(
                    "Native automation orphan/enum target dropped: {target}"
                ));
                continue;
            };
            for point in &mut points {
                point.v = clamp_number(point.v, binding.min, binding.max);
            }
            if points.is_empty() {
                diagnostics.push(format!("Native automation empty lane dropped: {target}"));
                continue;
            }
            if !matches!(target, "volume" | "rate") && binding.mapped_targets.is_empty() {
                diagnostics.push(format!("Native automation has no enabled AudioParam (tail still observes lane): {target}"));
            }
            if lanes.iter().any(|lane| lane.target == target) {
                diagnostics.push(format!(
                    "Native duplicate automation target retained in declaration order: {target}"
                ));
            }
            let (events, values) = expansion(&points, &binding);
            scheduled_events += events;
            expanded_curve_values += values;
            if expanded_curve_values > MAX_CURVE_VALUES {
                return Err(
                    "HyperFrames FX automation exceeds the expanded curve safety limit".into(),
                );
            }
            lanes.push(Lane {
                target: target.to_owned(),
                points,
            });
        }
    }
    let point_count = lanes.iter().map(|lane| lane.points.len()).sum();
    let fx: Vec<_> = lanes
        .iter()
        .filter(|lane| !matches!(lane.target.as_str(), "volume" | "rate"))
        .collect();
    let volume: Vec<_> = lanes
        .iter()
        .filter(|lane| lane.target == "volume")
        .collect();
    Ok(FxAutomationAdmission {
        fx_automation: (!fx.is_empty()).then(|| json!({"version":1,"lanes":fx})),
        volume_automation: (!volume.is_empty())
            .then(|| json!({"version":1,"lanes":volume}).to_string()),
        volume_points: volume.first().map(|lane| lane.points.clone()),
        rate_points: lanes
            .iter()
            .find(|lane| lane.target == "rate")
            .map(|lane| lane.points.clone()),
        point_count,
        expanded_curve_values,
        scheduled_events,
        tail_seconds: tail_seconds(chain, &lanes),
        diagnostics,
    })
}
