#[path = "support/hyperframes_execution.rs"]
mod support;
use editor_api::{
    apply_hyperframes_audio_track_gain_pcm, resolve_hyperframes_audio_observations_json,
};
use serde_json::{Value, json};
use support::*;

fn gain(time: f64, value: f64, previous: Option<f64>, current: f64) -> Value {
    json!({"state":"observed","observedAt":time,"gainBeforeFades":value,
        "source":"fallback","points":null,"fades":{"fadeIn":0,"fadeOut":0},
        "fallback":{"routed":false,"previousRuntimeVolume":previous,
            "currentElementVolume":current,"baselineGain":0.5}})
}

fn fixture() -> Value {
    let mut input = request();
    let track = &mut input["graph"]["snapshot"]["tracks"][0];
    track["native"]
        .as_object_mut()
        .unwrap()
        .remove("volumeKeyframes");
    track["resolvedAuthorGain"] = gain(0.0, 0.25, None, 0.25);
    let events = [
        (0.0, 0.25, None, 0.25),
        (0.04, 0.75, Some(0.25), 0.75),
        (0.04, 0.5, Some(0.75), 0.75),
        (0.08, 0.5, Some(0.5), 0.5),
    ]
    .into_iter()
    .enumerate()
    .map(|(sequence, (time, value, previous, current))| {
        json!({"sequence":sequence,"appliedAuthorGain":value,"effectiveElementVolume":value,
                "gain":gain(time,value,previous,current)})
    })
    .collect::<Vec<_>>();
    input["fallbackHistories"] = json!([{"profile":"hyperframes-native-sync-all-author-writes-v1",
        "instanceId":"track#1","resourceId":"a".repeat(64),"canonicalStart":0,
        "canonicalEnd":0.1,"events":events}]);
    input
}

#[test]
fn native_history_rejects_foreign_identity_incomplete_coverage_and_missing_writes() {
    let good = fixture();
    prepared(&good);
    for (pointer, value) in [
        ("/fallbackHistories/0/profile", json!("snapshot-fit")),
        ("/fallbackHistories/0/resourceId", json!("b".repeat(64))),
        ("/fallbackHistories/0/canonicalStart", json!(0.01)),
        ("/fallbackHistories/0/canonicalEnd", json!(0.08)),
        ("/fallbackHistories/0/events", json!([])),
        ("/fallbackHistories/0/events/1/sequence", json!(3)),
        ("/fallbackHistories/0/events/3/gain/observedAt", json!(0.03)),
        ("/fallbackHistories/0/events/0/gain/observedAt", json!(0.01)),
        (
            "/fallbackHistories/0/events/1/gain/fallback/previousRuntimeVolume",
            json!(0.5),
        ),
        (
            "/fallbackHistories/0/events/1/appliedAuthorGain",
            json!(0.6),
        ),
        (
            "/fallbackHistories/0/events/1/effectiveElementVolume",
            json!(1.1),
        ),
        (
            "/fallbackHistories/0/events/1/gain/fades/fadeIn",
            json!(0.01),
        ),
        (
            "/fallbackHistories/0/events/1/gain/source",
            json!("normalized-GSAP"),
        ),
    ] {
        let mut bad = good.clone();
        *bad.pointer_mut(pointer).unwrap() = value;
        let result = resolve(&bad);
        assert!(result["error"].is_string(), "{pointer}: {result}");
    }
    let mut bad = good.clone();
    bad["fallbackHistories"][0]["instanceId"] = json!("author-id-not-instance-id");
    rejected(&bad, "Unknown");
    bad["fallbackHistories"] = json!([good["fallbackHistories"][0], good["fallbackHistories"][0]]);
    rejected(&bad, "duplicate");
}

#[test]
fn post_fx_pcm_uses_last_actual_duplicate_write_without_interpolation_or_refade() {
    let input = fixture();
    let plan = prepared(&input);
    assert!(plan["tracks"][0]["fader"].is_null());
    let frames = plan["tracks"][0]["fxStage"]["expectedOutputFrames"]
        .as_u64()
        .unwrap() as usize;
    let pcm = samples(
        apply_hyperframes_audio_track_gain_pcm(envelope(&input, "track#1", &vec![1.0; frames * 2]))
            .unwrap(),
    );
    assert_eq!(pcm[0], 0.25);
    assert_eq!(pcm[1200 * 2], 0.25);
    assert_eq!(pcm[1920 * 2], 0.5);
    assert_eq!(pcm[3000 * 2], 0.5);
}

#[test]
fn inert_histories_are_validated_but_not_retained_and_observations_share_validation() {
    let mut input = fixture();
    input["graph"]["snapshot"]["tracks"][0]["authoredMuted"] = json!(true);
    let plan = prepared(&input);
    assert!(plan["tracks"][0].get("nativeGainHistory").is_none());
    input["fallbackHistories"][0]["events"][1]["sequence"] = json!(8);
    rejected(&input, "missing");
    let input = fixture();
    let observed = json!({"version":1,"graph":input["graph"],"observations":[],
        "fallbackHistories":input["fallbackHistories"]});
    let result: Value = serde_json::from_str(&resolve_hyperframes_audio_observations_json(
        observed.to_string(),
    ))
    .unwrap();
    assert!(result.get("error").is_none(), "{result}");
    assert_eq!(result["fallbackHistories"], input["fallbackHistories"]);
    assert_eq!(result["faderObservations"], json!([]));
}

#[test]
fn total_observation_json_keeps_existing_four_mib_execution_cap() {
    let input = fixture();
    let mut observed = json!({"version":1,"graph":input["graph"],"observations":[],
        "fallbackHistories":input["fallbackHistories"]})
    .to_string();
    // Whitespace does not add unknown semantic fields. It still consumes the
    // whole-request byte budget before parsing/admitting any event arrays.
    observed.push_str(&" ".repeat(4 * 1024 * 1024));
    let result: Value =
        serde_json::from_str(&resolve_hyperframes_audio_observations_json(observed)).unwrap();
    assert!(
        result["error"]
            .as_str()
            .unwrap()
            .contains("byte safety limit")
    );
}
