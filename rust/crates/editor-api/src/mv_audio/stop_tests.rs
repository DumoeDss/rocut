use super::*;
use crate::mv_audio::Data;
use serde_json::json;

fn canonical() -> Value {
    json!({"schema":"rocut-mv-audio/1","duration":1,"fps":1,
        "provenance":{"schema":"creator-mv-audio/1","inputSha256":"a".repeat(64),
            "manifestSha256":"b".repeat(64),"musicSha256":"c".repeat(64),
            "envelopesSha256":"d".repeat(64),
            "review":{"status":"accepted","reference":"stop fixture"}},
        "beats":[],"downbeats":[],
        "channels":{"mix_rms":[0],"low_power":[0],"mid_power":[0],"high_power":[0]},
        "scales":{"mix_rms":0,"low_power":0,"mid_power":0,"high_power":0}})
}

#[test]
fn absent_empty_and_explicit_null_remain_distinct() {
    let mut value = canonical();
    let old: Data = serde_json::from_value(value.clone()).unwrap();
    old.validate().unwrap();
    assert!(old.stops.is_none());
    assert!(serde_json::to_value(old).unwrap().get("stops").is_none());
    value["stops"] = json!([]);
    let empty: Data = serde_json::from_value(value.clone()).unwrap();
    empty.validate().unwrap();
    assert_eq!(serde_json::to_value(empty).unwrap()["stops"], json!([]));
    value["stops"] = Value::Null;
    assert!(serde_json::from_value::<Data>(value).is_err());
    assert!(from_music(&json!({}), 1.0).unwrap().is_none());
    assert!(
        from_music(&json!({"stops":[]}), 1.0)
            .unwrap()
            .unwrap()
            .is_empty()
    );
    assert!(from_music(&json!({"stops":null}), 1.0).is_err());
}

#[test]
fn import_retains_seconds_order_overlaps_kind_and_depth_without_normalizing() {
    let value = json!({"stops":[
        {"start":0.300001,"end":0.8,"kind":"gap","depth_db":9.25},
        {"start":0.1,"end":0.7,"kind":"stop"},
        {"start":0.1,"end":0.7,"kind":"stop","depth_db":-2.0}]});
    let events = from_music(&value, 1.0).unwrap().unwrap();
    assert_eq!(events.len(), 3);
    assert_eq!(events[0].kind, StopKind::Gap);
    assert_eq!(events[0].start, 0.300001);
    assert_eq!(events[1].start, events[2].start);
    assert_eq!(events[2].depth_db, Some(-2.0));
    let mut canonical = canonical();
    canonical["stops"] = serde_json::to_value(&events).unwrap();
    let parsed: Data = serde_json::from_value(canonical.clone()).unwrap();
    parsed.validate().unwrap();
    assert_eq!(
        serde_json::to_value(parsed).unwrap()["stops"],
        canonical["stops"]
    );
    assert!(canonical["stops"][1].get("depthDb").is_none());
}

#[test]
fn rejects_malformed_facts_without_repairing_them() {
    for event in [
        json!({"start":0.1,"end":0.2,"kind":"silence"}),
        json!({"start":-0.1,"end":0.2,"kind":"stop"}),
        json!({"start":0.2,"end":0.2,"kind":"stop"}),
        json!({"start":0.3,"end":0.2,"kind":"stop"}),
        json!({"start":0.1,"end":1.01,"kind":"stop"}),
        json!({"start":0.1,"end":0.2,"kind":"stop","depth_db":null}),
        json!({"start":0.1,"end":0.2,"kind":"stop","guessed":true}),
    ] {
        assert!(from_music(&json!({"stops":[event]}), 1.0).is_err());
    }
    let event = json!({"start":0.1,"end":0.2,"kind":"stop"});
    assert!(from_music(&json!({"stops":vec![event;MAX_STOPS+1]}), 1.0).is_err());
    for value in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        let mut event = Stop {
            start: 0.1,
            end: 0.2,
            kind: StopKind::Stop,
            depth_db: Some(value),
        };
        assert!(validate(&[event.clone()], 1.0).is_err());
        event.depth_db = None;
        event.start = value;
        assert!(validate(&[event.clone()], 1.0).is_err());
        event.start = 0.1;
        event.end = value;
        assert!(validate(&[event], 1.0).is_err());
    }
}
