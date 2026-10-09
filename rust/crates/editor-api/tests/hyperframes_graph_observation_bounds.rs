#[path = "support/hyperframes_observations.rs"]
mod support;
use editor_api::resolve_hyperframes_audio_observations_json;
use serde_json::{Value, json};
use support::{observation, rejected, request};

#[test]
fn well_formed_fallback_observations_still_do_not_prove_complete_history() {
    let mut input = request();
    for track in input["graph"]["snapshot"]["tracks"].as_array_mut().unwrap() {
        track["native"]
            .as_object_mut()
            .unwrap()
            .remove("volumeKeyframes");
        track["resolvedAuthorGain"] = json!({"state":"unobserved"});
    }
    let mut fresh = observation(&input["graph"]["snapshot"], 0.02);
    for track in fresh["tracks"].as_array_mut().unwrap() {
        track["resolvedAuthorGain"] = json!({"state":"observed","observedAt":0.02,
            "gainBeforeFades":0.5,"source":"fallback","points":null,
            "fades":{"fadeIn":0,"fadeOut":0},"fallback":{"routed":false,
                "previousRuntimeVolume":null,"currentElementVolume":0.5,"baselineGain":0.5}});
    }
    input["observations"] = json!([fresh]);
    let result = rejected(&input);
    assert!(
        result["error"]
            .as_str()
            .unwrap()
            .contains("complete native history")
    );
}

#[test]
fn consistent_snapshot_clocks_cannot_forge_an_active_gain_at_the_native_end() {
    let mut input = request();
    input["observations"] = json!([observation(&input["graph"]["snapshot"], 0.1)]);
    let result = rejected(&input);
    assert!(
        result["error"]
            .as_str()
            .unwrap()
            .contains("clock/fade facts")
    );
}

#[test]
fn bounds_resolved_history_points_across_all_snapshots_before_emitting_facts() {
    let mut input = request();
    let points: Vec<Value> = (0..4096)
        .map(|i| json!({"t":f64::from(i)/40960.0,"v":2}))
        .collect();
    let keyframes: Vec<Value> = points
        .iter()
        .map(|point| json!({"time":point["t"],"volume":point["v"]}))
        .collect();
    for track in input["graph"]["snapshot"]["tracks"].as_array_mut().unwrap() {
        track["native"]["volumeKeyframes"] = json!(keyframes);
        track["resolvedAuthorGain"]["points"] = json!(points);
    }
    let fresh = observation(&input["graph"]["snapshot"], 0.02);
    input["observations"] = json!(vec![fresh; 4]);
    let result = rejected(&input);
    assert!(
        result["error"]
            .as_str()
            .unwrap()
            .contains("point safety limit")
    );
}

#[test]
fn bounds_serialized_payload_before_json_parsing() {
    let result: Value = serde_json::from_str(&resolve_hyperframes_audio_observations_json(
        " ".repeat(4 * 1024 * 1024 + 1),
    ))
    .unwrap();
    assert!(
        result["error"]
            .as_str()
            .unwrap()
            .contains("byte safety limit")
    );
    assert!(result.get("faderObservations").is_none());
}
