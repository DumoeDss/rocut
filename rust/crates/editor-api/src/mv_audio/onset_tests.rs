use super::{METHOD, StrongOnsets};
use crate::mv_audio::Data;
use serde_json::{Value, json};

fn canonical() -> Value {
    json!({"schema":"rocut-mv-audio/1","duration":0.1,"fps":10,
        "provenance":{"schema":"creator-mv-audio/1","inputSha256":"a".repeat(64),
            "manifestSha256":"b".repeat(64),"musicSha256":"c".repeat(64),
            "envelopesSha256":"d".repeat(64),
            "review":{"status":"accepted","reference":"onset fixture"}},
        "beats":[],"downbeats":[],
        "channels":{"mix_rms":[0],"low_power":[0],"mid_power":[0],"high_power":[0]},
        "scales":{"mix_rms":0,"low_power":0,"mid_power":0,"high_power":0}})
}

fn facts() -> Value {
    json!({"method":METHOD,"normalizationScale":2,
        "events":[{"atTicks":1200,"strength":-0.25},{"atTicks":2400,"strength":1}]})
}

#[test]
fn old_absence_and_explicit_analyzed_empty_survive_roundtrip_as_distinct_facts() {
    let mut value = canonical();
    let old: Data = serde_json::from_value(value.clone()).unwrap();
    old.validate().unwrap();
    assert!(old.strong_onsets.is_none());
    assert!(
        serde_json::to_value(old)
            .unwrap()
            .get("strongOnsets")
            .is_none()
    );
    value["strongOnsets"] = json!({"method":METHOD,"normalizationScale":0.0,"events":[]});
    let empty: Data = serde_json::from_value(value.clone()).unwrap();
    empty.validate().unwrap();
    assert!(empty.strong_onsets.as_ref().unwrap().events.is_empty());
    assert_eq!(
        serde_json::to_value(empty).unwrap()["strongOnsets"],
        value["strongOnsets"]
    );
    value["strongOnsets"] = Value::Null;
    assert!(serde_json::from_value::<Data>(value).is_err());
}

#[test]
fn canonical_rejects_unknown_fields_nulls_and_wrong_coordinate_types() {
    for (pointer, bad) in [
        ("/method", json!("raw")),
        ("/events", Value::Null),
        ("/events/0", Value::Null),
        ("/events/0/atTicks", json!(-1)),
        ("/events/0/atTicks", json!(0.1)),
        ("/events/0/strength", Value::Null),
        ("/normalizationScale", json!(0)),
    ] {
        let mut value = facts();
        *value.pointer_mut(pointer).unwrap() = bad;
        assert!(
            serde_json::from_value::<StrongOnsets>(value)
                .map_or(true, |facts| facts.validate(0.1).is_err()),
            "accepted {pointer}"
        );
    }
    for event_unknown in [false, true] {
        let mut value = facts();
        if event_unknown {
            value["events"][0]["time"] = json!(0.01);
        } else {
            value["band"] = json!("kick");
        }
        assert!(serde_json::from_value::<StrongOnsets>(value).is_err());
    }
}

#[test]
fn rejects_nonfinite_scale_or_intensity_without_lower_clipping_valid_residuals() {
    let parsed: StrongOnsets = serde_json::from_value(facts()).unwrap();
    parsed.validate(0.1).unwrap();
    assert_eq!(parsed.events[0].strength, -0.25);
    for invalid in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        let mut parsed: StrongOnsets = serde_json::from_value(facts()).unwrap();
        parsed.normalization_scale = invalid;
        assert!(parsed.validate(0.1).is_err());
        parsed.normalization_scale = 2.0;
        parsed.events[0].strength = invalid;
        assert!(parsed.validate(0.1).is_err());
    }
}

#[test]
fn validates_event_bounds_and_empty_normalization_without_invented_facts() {
    for (pointer, bad) in [
        ("/events/0/strength", json!(1.001)),
        ("/events/1/atTicks", json!(1200)),
        ("/events/1/atTicks", json!(1)),
        ("/events/1/atTicks", json!(12000)),
        ("/normalizationScale", json!(-1)),
    ] {
        let mut value = facts();
        *value.pointer_mut(pointer).unwrap() = bad;
        let parsed: StrongOnsets = serde_json::from_value(value).unwrap();
        assert!(parsed.validate(0.1).is_err(), "accepted {pointer}");
    }
    let mut value = facts();
    value["events"] = json!([]);
    let parsed: StrongOnsets = serde_json::from_value(value).unwrap();
    assert!(parsed.validate(0.1).is_err());
    let mut value = facts();
    value["events"] = json!(
        (0..521)
            .map(|i| json!({"atTicks":i,"strength":0.5}))
            .collect::<Vec<_>>()
    );
    let parsed: StrongOnsets = serde_json::from_value(value).unwrap();
    assert!(parsed.validate(0.1).is_err());
}
