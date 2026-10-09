use editor_api::resolve_hyperframes_audio_discovery_json;
use serde_json::{Value, json};

fn track(id: &str, start: f64, end: f64) -> Value {
    json!({"instanceId":id,"authorId":"repeated","resourceId":"a".repeat(64),
        "type":"audio","authoredMuted":false,"ancestorHidden":false,"observedAt":0,
        "native":{"start":start,"end":end,"duration":end-start,"mediaStart":0,
            "sourceDuration":1,"playbackRate":1,"rate":1,"loop":false,"volume":1,
            "fades":{"fadeIn":0,"fadeOut":0}},
        "attributes":{"groupRenderId":null,"groupAuthorId":null,"fxChain":null,
            "automation":null,"muted":false,"hasAudio":null}})
}

fn request(tracks: Vec<Value>) -> Value {
    json!({"version":1,"semanticsProfile":"rocut-hyperframes-0.8.139-audio-graph-v1",
        "frameRate":{"numerator":25,"denominator":1},"sampleRate":48000,
        "firstFrame":0,"frameCount":25,"durationFrames":25,
        "sources":[{"id":"a".repeat(64),"mimeType":"audio/wav","byteLength":4096}],
        "snapshot":{"version":1,"nativeVersion":"0.8.139","time":0,"tracks":tracks,"buses":[]}})
}

fn resolve(input: &Value) -> Value {
    serde_json::from_str(&resolve_hyperframes_audio_discovery_json(input.to_string())).unwrap()
}

fn prepared(input: &Value) -> Value {
    let result = resolve(input);
    assert!(result.get("error").is_none(), "{result}");
    result["plan"].clone()
}

#[test]
fn discovers_clips_wholly_between_picture_frames_without_rounding() {
    let plan = prepared(&request(vec![track("subframe", 0.101, 0.103)]));
    let time = plan["seeks"][0]["time"].as_f64().unwrap();
    assert!((time - 0.102).abs() < 1e-15);
    assert!(time >= 0.101 && time < 0.103);
    assert!((0..25).all(|frame| {
        let picture_time = f64::from(frame) / 25.0;
        picture_time < 0.101 || picture_time >= 0.103
    }));
    assert_eq!(plan["seeks"][0]["instanceIds"], json!(["subframe"]));
    assert_eq!(plan["stage"], "gain-discovery-only");
    assert_eq!(plan["executionReady"], false);
    assert_eq!(plan["historyComplete"], false);
}

#[test]
fn retains_muted_hidden_tracks_and_coalesces_equal_seeks_by_instance_not_author() {
    let mut muted = track("b", 0.1, 0.3);
    muted["authoredMuted"] = json!(true);
    muted["ancestorHidden"] = json!(true);
    let plan = prepared(&request(vec![muted, track("a", 0.1, 0.3)]));
    assert_eq!(plan["seeks"].as_array().unwrap().len(), 1);
    assert_eq!(plan["seeks"][0]["instanceIds"], json!(["a", "b"]));
    assert_eq!(plan["noActiveIntervalInstanceIds"], json!([]));
}

#[test]
fn full_and_partial_requests_discover_the_same_complete_composition() {
    let input = request(vec![track("early", 0.01, 0.03), track("late", 0.8, 1.2)]);
    let full = prepared(&input);
    let mut partial = input;
    partial["firstFrame"] = json!(15);
    partial["frameCount"] = json!(2);
    assert_eq!(prepared(&partial), full);
    assert_eq!(full["seeks"][1]["time"], 0.9);
}

#[test]
fn never_seeks_outside_exact_composition_or_treats_empty_windows_as_silence() {
    let plan = prepared(&request(vec![
        track("end", 1.0, 1.1),
        track("empty", 0.5, 0.5),
        track("outside", 2.0, 3.0),
    ]));
    let time = plan["seeks"][0]["time"].as_f64().unwrap();
    assert!(time < 1.0 && 1.0 - time <= 4.0 * f64::EPSILON);
    assert_eq!(plan["seeks"][0]["instanceIds"], json!(["end"]));
    assert_eq!(
        plan["noActiveIntervalInstanceIds"],
        json!(["empty", "outside"])
    );
    assert!(plan.get("silentInstanceIds").is_none());
    let mut ntsc = request(vec![track("tail", 0.099, 0.11)]);
    ntsc["frameRate"] = json!({"numerator":30000,"denominator":1001});
    ntsc["durationFrames"] = json!(3);
    ntsc["frameCount"] = json!(3);
    let plan = prepared(&ntsc);
    let time = plan["seeks"][0]["time"].as_f64().unwrap();
    assert!((time - 0.09955).abs() < 1e-15);
    assert!(time < 0.1001);
}

#[test]
fn native_end_tolerance_rejects_a_numeric_midpoint_and_falls_back_to_start() {
    let start = 0.5_f64;
    // Actual core 0.8.139 isInClipWindow: the midpoint is the native end
    // instant, but the declared start still lies outside its end tolerance.
    let end = f64::from_bits(start.to_bits() + 12);
    let plan = prepared(&request(vec![track("tiny", start, end)]));
    let time = plan["seeks"][0]["time"].as_f64().unwrap();
    assert_eq!(time, start);
    assert_eq!(plan["boundaryLimitedInstanceIds"], json!([]));
}

#[test]
fn adjacent_float_window_uses_native_early_tolerance_instead_of_claiming_silence() {
    let start = 0.5_f64;
    let end = f64::from_bits(start.to_bits() + 1);
    let plan = prepared(&request(vec![track("tiny", start, end)]));
    let time = plan["seeks"][0]["time"].as_f64().unwrap();
    assert_eq!(time, start - 4.0 * f64::EPSILON);
    assert!(time < start);
    assert!(end - time > 4.0 * f64::EPSILON);
    assert_eq!(plan["noActiveIntervalInstanceIds"], json!([]));
    assert_eq!(plan["boundaryLimitedInstanceIds"], json!([]));
    assert_eq!(plan["historyComplete"], false);
}

#[test]
fn discovery_reuses_full_admission_including_identity_topology_fx_and_source_budgets() {
    let base = request(vec![track("a", 0.1, 0.2)]);
    let mut invalids = Vec::new();
    let mut duplicate = base.clone();
    duplicate["snapshot"]["tracks"]
        .as_array_mut()
        .unwrap()
        .push(track("a", 0.3, 0.4));
    invalids.push(duplicate);
    for (key, value) in [
        ("groupRenderId", json!("missing")),
        ("fxChain", json!("broken-json")),
    ] {
        let mut invalid = base.clone();
        invalid["snapshot"]["tracks"][0]["attributes"][key] = value;
        invalids.push(invalid);
    }
    let mut source = base.clone();
    source["sources"][0]["byteLength"] = json!(128 * 1024 * 1024);
    invalids.push(source);
    let mut clock = base;
    clock["frameRate"]["numerator"] = json!(0);
    invalids.push(clock);
    for invalid in invalids {
        let result = resolve(&invalid);
        assert!(result.get("error").is_some(), "{result}");
        assert!(result.get("plan").is_none());
    }
}
