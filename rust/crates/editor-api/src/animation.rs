use crate::{model::*, validate_value};
use serde::Deserialize;
use serde_json::Value;
use std::collections::BTreeSet;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Handle {
    dt: i64,
    dv: f64,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Key {
    id: String,
    time: u64,
    value: Value,
    segment_to_next: Option<String>,
    tangent_mode: Option<String>,
    left_handle: Option<Handle>,
    right_handle: Option<Handle>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Extrapolation {
    before: String,
    after: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Channel {
    keys: Vec<Key>,
    extrapolation: Option<Extrapolation>,
}

fn channel(value: &Value, param: &Param, path: &str, issues: &mut Vec<Issue>) {
    let Ok(channel) = serde_json::from_value::<Channel>(value.clone()) else {
        issues.push(Issue::new(path, "Invalid animation channel schema"));
        return;
    };
    let numeric = param.kind == "number";
    if let Some(extrapolation) = &channel.extrapolation {
        if !numeric
            || ![&extrapolation.before, &extrapolation.after]
                .iter()
                .all(|s| matches!(s.as_str(), "hold" | "linear"))
        {
            issues.push(Issue::new(path, "Invalid channel extrapolation"));
        }
    }
    let mut ids = BTreeSet::new();
    let mut previous_time = None;
    for key in channel.keys {
        if key.id.is_empty()
            || !ids.insert(key.id.clone())
            || key.time > 9_007_199_254_740_991
            || previous_time.is_some_and(|t| t >= key.time)
        {
            issues.push(Issue::new(path, "Keyframes require unique IDs and strictly increasing nonnegative safe-integer ticks"));
        }
        previous_time = Some(key.time);
        validate_value(&key.value, param, path, issues);
        if numeric {
            if !matches!(
                key.segment_to_next.as_deref(),
                Some("step" | "linear" | "bezier")
            ) || !matches!(
                key.tangent_mode.as_deref(),
                Some("auto" | "aligned" | "broken" | "flat")
            ) {
                issues.push(Issue::new(
                    path,
                    "Scalar keys require segmentToNext and tangentMode",
                ));
            }
            if key
                .left_handle
                .as_ref()
                .is_some_and(|h| h.dt > 0 || h.dt < -9_007_199_254_740_991 || !h.dv.is_finite())
                || key
                    .right_handle
                    .as_ref()
                    .is_some_and(|h| h.dt < 0 || h.dt > 9_007_199_254_740_991 || !h.dv.is_finite())
            {
                issues.push(Issue::new(
                    path,
                    "Handle dt must be a safe integer; left <= 0, right >= 0",
                ));
            }
        } else if key.segment_to_next.is_some()
            || key.tangent_mode.is_some()
            || key.left_handle.is_some()
            || key.right_handle.is_some()
        {
            issues.push(Issue::new(
                path,
                "Discrete keys cannot have scalar curve fields",
            ));
        }
    }
}

pub fn validate(request: &Request, definitions: &[Param], issues: &mut Vec<Issue>) {
    if request.duration == 0 {
        issues.push(Issue::new("duration", "Clip duration must be positive"));
    }
    for (property, value) in &request.editing.animations {
        let path = format!("editing.animations.{property}");
        let param = if let Some(tail) = property.strip_prefix("effects.") {
            tail.split_once(".params.").and_then(|(id, key)| {
                request
                    .editing
                    .effects
                    .iter()
                    .find(|effect| effect.id == id)
                    .and_then(|effect| request.catalog.effects.get(&effect.kind))
                    .and_then(|params| params.iter().find(|param| param.key == key))
            })
        } else if let Some(key) = property.strip_prefix("params.") {
            request
                .editing
                .definition_id
                .as_ref()
                .and_then(|id| request.catalog.graphics.get(id))
                .and_then(|params| params.iter().find(|param| param.key == key))
        } else {
            definitions.iter().find(|param| param.key == *property)
        };
        let Some(param) = param else {
            issues.push(Issue::new(&path, "Unknown animation property"));
            continue;
        };
        if param.keyframable == Some(false) {
            issues.push(Issue::new(&path, "Parameter is not keyframable"));
            continue;
        }
        if param.kind == "color" {
            let Some(components) = value.as_object() else {
                issues.push(Issue::new(
                    &path,
                    "Color channels require linear RGBA components",
                ));
                continue;
            };
            for (component, value) in components {
                if !["r", "g", "b", "a"].contains(&component.as_str()) {
                    issues.push(Issue::new(&path, "Unknown color component"));
                    continue;
                }
                let scalar = Param {
                    key: component.clone(),
                    kind: "number".into(),
                    min: Some(0.0),
                    max: Some(1.0),
                    display_multiplier: None,
                    keyframable: Some(true),
                    options: vec![],
                };
                channel(value, &scalar, &format!("{path}.{component}"), issues);
            }
        } else {
            channel(value, param, &path, issues);
        }
    }
}
