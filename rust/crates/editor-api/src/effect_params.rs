use std::collections::BTreeMap;

use serde_json::Value;

use crate::model::Issue;

pub(crate) fn validate(
    kind: &str,
    params: &BTreeMap<String, Value>,
    path: &str,
    issues: &mut Vec<Issue>,
) {
    if matches!(kind, "displacement" | "decrypt-reveal" | "droplets" | "clouds") {
        if let Some(seed) = params.get("seed").and_then(Value::as_f64) {
            if seed.fract() != 0.0 {
                issues.push(Issue::new(
                    &format!("{path}.seed"),
                    "Seed must be an integer",
                ));
            }
        }
    }
    if kind == "droplets" {
        if let Some(count) = params.get("count").and_then(Value::as_f64) {
            if count.fract() != 0.0 {
                issues.push(Issue::new(
                    &format!("{path}.count"),
                    "Droplet count must be an integer",
                ));
            }
        }
    }
    if kind == "laser" {
        if let Some(direction) = params.get("direction").and_then(Value::as_f64) {
            if direction.fract() != 0.0 {
                issues.push(Issue::new(
                    &format!("{path}.direction"),
                    "Direction must be an integer",
                ));
            }
        }
    }
    if !matches!(kind, "ripple" | "force-field" | "liquid") {
        return;
    }
    // Validate authored slots before optional catalog defaults can fill missing events.
    let numeric = params
        .iter()
        .filter_map(|(key, value)| value.as_f64().map(|number| (key.clone(), number)))
        .collect();
    let schedule = if kind == "liquid" {
        effects::validate_liquid_schedule(&numeric)
    } else {
        effects::validate_wave_schedule(&numeric).map(|_| ())
    };
    if let Err(message) = schedule {
        issues.push(Issue::new(path, &message));
    }
}
