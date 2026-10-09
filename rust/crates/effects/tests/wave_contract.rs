use std::collections::BTreeMap;

use effects::{
    MAX_WAVE_EVENTS, resolve_stylized_effect_json, stylized_effect_catalog_json,
    validate_wave_schedule,
};
use serde_json::{Value, json};

fn impact(time: i64) -> Value {
    json!({"eventCount":1,"event0Time":time,"event0X":0.3,"event0Y":0.6,"event0Amplitude":0.8})
}

fn resolve(params: Value, local_time: i64, numerator: u32, denominator: u32) -> Value {
    serde_json::from_str(&resolve_stylized_effect_json(
        json!({
            "effectType":"ripple","params":params,"localTime":local_time,
            "frameRate":{"numerator":numerator,"denominator":denominator}
        })
        .to_string(),
    ))
    .unwrap()
}

#[test]
fn catalog_advertises_the_single_schedule_budget_and_nonanimated_impacts() {
    let catalog: Vec<Value> = serde_json::from_str(&stylized_effect_catalog_json()).unwrap();
    for name in ["ripple", "force-field"] {
        let entry = catalog.iter().find(|entry| entry["id"] == name).unwrap();
        let fields = entry["fields"].as_array().unwrap();
        let count = fields
            .iter()
            .find(|field| field["key"] == "eventCount")
            .unwrap();
        assert_eq!(count["max"].as_f64(), Some(MAX_WAVE_EVENTS as f64));
        assert_eq!(count["keyframable"], false);
        let slots: Vec<_> = fields
            .iter()
            .filter(|field| {
                field["key"].as_str().unwrap().starts_with("event") && field["key"] != "eventCount"
            })
            .collect();
        assert_eq!(slots.len(), MAX_WAVE_EVENTS * 4);
        for slot in slots {
            assert_eq!(slot["keyframable"], false);
            assert_eq!(slot["required"], false);
        }
    }
}

#[test]
fn schedule_requires_complete_active_events_without_truncation_or_rounding() {
    let mut params: BTreeMap<String, f64> = serde_json::from_value(impact(0)).unwrap();
    assert_eq!(validate_wave_schedule(&params), Ok(1));
    for (key, value) in [
        ("eventCount", 17.0),
        ("eventCount", 1.5),
        ("eventCount", f64::NAN),
        ("event0Time", 0.5),
        ("event0Time", -1.0),
        ("event0Time", 9_007_199_254_740_992.0),
        ("event0X", f64::INFINITY),
        ("event0Y", 2.1),
        ("event0Amplitude", 1.1),
        ("event16Time", 0.0),
    ] {
        let mut invalid = params.clone();
        invalid.insert(key.into(), value);
        assert!(
            validate_wave_schedule(&invalid).is_err(),
            "accepted {key}={value}"
        );
    }
    params.remove("event0Amplitude");
    assert!(validate_wave_schedule(&params).is_err());
    params.insert("eventCount".into(), 0.0);
    assert_eq!(
        validate_wave_schedule(&params),
        Ok(0),
        "inactive groups may be absent or partial"
    );
    params.insert("event15Time".into(), -1.0);
    assert!(
        validate_wave_schedule(&params).is_err(),
        "provided inactive values must still be valid"
    );
}

#[test]
fn rational_sample_ticks_are_subtracted_before_float_conversion() {
    assert_eq!(
        resolve(impact(4000), 4003, 30000, 1001)["passes"],
        json!([])
    );
    let first = resolve(impact(4000), 4004, 30000, 1001);
    assert_eq!(first["frameIndex"], 1);
    assert!(
        (first["passes"][0]["uniforms"]["events"][2]
            .as_f64()
            .unwrap()
            - 4.0 / 120_000.0)
            .abs()
            < 1e-12
    );
    assert_eq!(first, resolve(impact(4000), 8007, 30000, 1001));
    let event = (9_007_199_244_740_991i64 / 4004) * 4004;
    let distant = resolve(impact(event), event + 4004, 30000, 1001);
    assert!(
        (distant["passes"][0]["uniforms"]["events"][2]
            .as_f64()
            .unwrap()
            - 4004.0 / 120_000.0)
            .abs()
            < 1e-12
    );
    assert_eq!(distant, resolve(impact(event), event + 4004, 30000, 1001));
    assert_eq!(resolve(impact(0), -1, 30, 1)["frameIndex"], -1);
    for (time, n, d) in [
        (0, 0, 1),
        (0, 7, 3),
        (0, 120001, 1),
        (0, 30, 1002),
        (9_007_199_254_740_992, 30, 1),
    ] {
        assert!(resolve(impact(0), time, n, d).get("error").is_some());
    }
}

#[test]
fn schedules_survive_arbitrary_seek_with_exact_idle_and_full_budget() {
    let mut params = impact(120_000);
    params["lifetime"] = json!(1);
    for t in [-120_000, 0, 120_000, 240_000, 360_000] {
        assert_eq!(resolve(params.clone(), t, 30, 1)["passes"], json!([]));
    }
    let expected = resolve(params.clone(), 180_000, 30, 1);
    assert_eq!(expected["passes"].as_array().unwrap().len(), 1);
    for t in [360_000, 140_000, 0, 180_000, -1] {
        let _ = resolve(params.clone(), t, 30, 1);
    }
    assert_eq!(expected, resolve(params, 180_000, 30, 1));
    let mut full = serde_json::Map::new();
    full.insert("eventCount".into(), json!(MAX_WAVE_EVENTS));
    for i in 0..MAX_WAVE_EVENTS {
        for (suffix, value) in [("Time", 0.0), ("X", 0.5), ("Y", 0.5), ("Amplitude", 1.0)] {
            full.insert(format!("event{i}{suffix}"), json!(value));
        }
    }
    let resolved = resolve(Value::Object(full.clone()), 60_000, 30, 1);
    assert_eq!(
        resolved["passes"][0]["uniforms"]["events"]
            .as_array()
            .unwrap()
            .len(),
        MAX_WAVE_EVENTS * 4
    );
    full.insert("eventCount".into(), json!(MAX_WAVE_EVENTS + 1));
    assert!(
        resolve(Value::Object(full), 60_000, 30, 1)
            .get("error")
            .is_some()
    );
}

#[test]
fn independent_impacts_keep_their_centers_ages_and_signs() {
    let params = json!({"eventCount":2,"event0Time":120000,"event0X":0.2,"event0Y":0.3,"event0Amplitude":0.7,
        "event1Time":0,"event1X":0.8,"event1Y":0.6,"event1Amplitude":-0.4});
    let resolved = resolve(params.clone(), 60000, 30, 1);
    assert_eq!(
        resolved["passes"][0]["uniforms"]["events"],
        json!([0.2, 0.3, -0.5, 0.7, 0.8, 0.6, 0.5, -0.4])
    );
    assert_eq!(params["event0Time"], 120000);
    assert_eq!(
        resolve(json!({"eventCount":0}), 60000, 30, 1)["passes"],
        json!([])
    );
    let mut zero = impact(0);
    zero["amount"] = json!(0);
    assert_eq!(resolve(zero, 60000, 30, 1)["passes"], json!([]));
}
