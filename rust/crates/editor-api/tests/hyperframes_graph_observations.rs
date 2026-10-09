#[path = "support/hyperframes_observations.rs"]
mod support;
use serde_json::{Value, json};
use support::{admitted, observation, rejected, request};

#[test]
fn accepts_stable_facts_at_fresh_times_and_orders_by_instance_not_author() {
    let mut input = request();
    let repeat = observation(&input["observations"][0], 0.05);
    input["observations"].as_array_mut().unwrap().push(repeat);
    let result = admitted(&input);
    let facts = result["faderObservations"].as_array().unwrap();
    assert_eq!(facts.len(), 2);
    assert_eq!(facts[0]["instanceId"], "track#1");
    assert_eq!(facts[1]["instanceId"], "track#2");
    assert_eq!(result["executionReady"], false);
    assert!(result.get("historyComplete").is_none());
}

#[test]
fn rejects_changed_declaration_order_even_when_instance_sets_and_all_facts_match() {
    for kind in ["tracks", "buses"] {
        let mut input = request();
        input["observations"][0][kind]
            .as_array_mut()
            .unwrap()
            .reverse();
        let result = rejected(&input);
        assert!(
            result["error"]
                .as_str()
                .unwrap()
                .contains("static declarations")
        );
    }
}

#[test]
fn fills_unobserved_baseline_with_native_envelopes_without_claiming_missing_history() {
    let mut input = request();
    for track in input["graph"]["snapshot"]["tracks"].as_array_mut().unwrap() {
        track["resolvedAuthorGain"] = json!({"state":"unobserved"});
    }
    let result = admitted(&input);
    assert_eq!(
        result["faderObservations"][0]["resolvedAuthorGain"]["observedAt"],
        0.02
    );
    input["observations"] = json!([]);
    assert_eq!(admitted(&input)["faderObservations"], json!([]));
    let execution = json!({"version":1,"graph":input["graph"],"faderObservations":[]});
    let result: Value = serde_json::from_str(
        &editor_api::resolve_hyperframes_audio_execution_plan_json(execution.to_string()),
    )
    .unwrap();
    assert!(
        result["error"]
            .as_str()
            .unwrap()
            .contains("Missing complete")
    );
}

#[test]
fn current_gain_can_change_only_as_evidenced_by_the_same_normalized_envelope() {
    let mut input = request();
    for track in input["graph"]["snapshot"]["tracks"].as_array_mut().unwrap() {
        track["native"]["volumeKeyframes"][1]["volume"] = json!(3);
        track["resolvedAuthorGain"]["points"][1]["v"] = json!(3);
    }
    let mut fresh = observation(&input["graph"]["snapshot"], 0.025);
    for track in fresh["tracks"].as_array_mut().unwrap() {
        track["resolvedAuthorGain"]["gainBeforeFades"] = json!(2.25);
    }
    input["observations"] = json!([fresh]);
    admitted(&input);
    input["observations"][0]["tracks"][0]["resolvedAuthorGain"]["gainBeforeFades"] = json!(2.5);
    rejected(&input);
}

#[test]
fn rejects_changed_native_identity_timing_mute_visibility_routing_fx_and_bus_facts() {
    let base = request();
    for (path, value) in [
        ("/tracks/0/authorId", json!("other")),
        ("/tracks/0/resourceId", json!("c".repeat(64))),
        ("/tracks/0/type", json!("video")),
        ("/tracks/0/authoredMuted", json!(true)),
        ("/tracks/0/ancestorHidden", json!(true)),
        ("/tracks/0/native/start", json!(0.01)),
        ("/tracks/0/native/end", json!(0.2)),
        ("/tracks/0/native/duration", json!(0.2)),
        ("/tracks/0/native/mediaStart", json!(0.001)),
        ("/tracks/0/native/sourceDuration", json!(0.02)),
        ("/tracks/0/native/playbackRate", json!(2)),
        ("/tracks/0/native/rate", json!(2)),
        ("/tracks/0/native/loop", json!(true)),
        ("/tracks/0/native/volume", json!(0.25)),
        ("/tracks/0/native/fades/fadeIn", json!(0.01)),
        ("/tracks/0/native/fades/fadeOut", json!(0.01)),
        ("/tracks/0/native/volumeKeyframes/0/volume", json!(1.5)),
        ("/tracks/0/attributes/groupRenderId", json!("bus#2")),
        ("/tracks/0/attributes/groupAuthorId", json!("changed")),
        (
            "/tracks/0/attributes/fxChain",
            json!("{\"version\":1,\"nodes\":[]} "),
        ),
        (
            "/tracks/0/attributes/automation",
            json!("{\"version\":1,\"lanes\":[]} "),
        ),
        ("/tracks/0/attributes/muted", json!(true)),
        ("/tracks/0/attributes/hasAudio", json!("false")),
        ("/buses/0/authorId", json!("changed")),
        ("/buses/0/hidden", json!(true)),
        ("/buses/0/attributes/volume", json!("0.25")),
        (
            "/buses/0/attributes/fxChain",
            json!("{\"version\":1,\"nodes\":[]} "),
        ),
        (
            "/buses/0/attributes/automation",
            json!("{\"version\":1,\"lanes\":[]} "),
        ),
    ] {
        let mut input = base.clone();
        *input["observations"][0].pointer_mut(path).unwrap() = value;
        rejected(&input);
    }
}

#[test]
fn fails_closed_on_added_missing_duplicate_or_author_only_instance_identity() {
    let base = request();
    for kind in ["tracks", "buses"] {
        let mut missing = base.clone();
        missing["observations"][0][kind]
            .as_array_mut()
            .unwrap()
            .pop();
        rejected(&missing);
        for id in [Value::Null, json!("fresh-instance"), json!("voice")] {
            let mut changed = base.clone();
            changed["observations"][0][kind][0]["instanceId"] = id;
            rejected(&changed);
        }
        let mut duplicate = base.clone();
        let entry = duplicate["observations"][0][kind][0].clone();
        duplicate["observations"][0][kind]
            .as_array_mut()
            .unwrap()
            .push(entry);
        rejected(&duplicate);
    }
}

#[test]
fn rejects_bad_observation_clock_fades_normalization_and_fallback_history() {
    let base = request();
    for (path, value) in [
        ("/time", json!(0.2)),
        ("/tracks/0/observedAt", json!(0.03)),
        ("/tracks/0/resolvedAuthorGain/observedAt", json!(0.03)),
        ("/tracks/0/resolvedAuthorGain/fades/fadeIn", json!(0.01)),
        ("/tracks/0/resolvedAuthorGain/points/0/v", json!(2.1)),
        (
            "/tracks/0/resolvedAuthorGain/source",
            json!("normalized-volume-lane"),
        ),
        (
            "/tracks/0/resolvedAuthorGain",
            json!({"state":"observed","observedAt":0.02,
            "gainBeforeFades":0.5,"source":"fallback","points":null,
            "fades":{"fadeIn":0,"fadeOut":0},"fallback":{"routed":false,
                "previousRuntimeVolume":null,"currentElementVolume":0.5,"baselineGain":0.5}}),
        ),
    ] {
        let mut input = base.clone();
        *input["observations"][0].pointer_mut(path).unwrap() = value;
        rejected(&input);
    }
}

#[test]
fn normal_admission_and_bounds_apply_before_any_observation_is_emitted() {
    let base = request();
    for (path, value) in [
        ("/version", json!(2)),
        ("/graph", json!(42)),
        ("/graph/sources/0/byteLength", json!(128 * 1024 * 1024)),
        ("/graph/frameRate/numerator", json!(0)),
        (
            "/graph/snapshot/tracks/0/attributes/groupRenderId",
            json!("missing"),
        ),
    ] {
        let mut input = base.clone();
        *input.pointer_mut(path).unwrap() = value;
        rejected(&input);
    }
    let mut excessive = base.clone();
    excessive["observations"] = json!(vec![base["observations"][0].clone(); 65]);
    rejected(&excessive);
    let mut unknown = base;
    unknown["observations"][0]["futureField"] = json!(true);
    rejected(&unknown);
}
