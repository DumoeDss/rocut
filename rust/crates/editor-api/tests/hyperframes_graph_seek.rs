use editor_api::{resolve_hyperframes_audio_discovery_json, resolve_hyperframes_audio_seek_json};
use serde_json::{Value, json};

#[path = "support/hyperframes_execution.rs"]
mod support;

fn input() -> Value {
    let mut graph = support::request()["graph"].clone();
    graph["frameRate"] = json!({"numerator":25,"denominator":1});
    graph["durationFrames"] = json!(8);
    graph["frameCount"] = json!(8);
    let track = &mut graph["snapshot"]["tracks"][0];
    track["native"]["start"] = json!(0.101);
    track["native"]["end"] = json!(0.103);
    track["native"]["duration"] = json!(0.002);
    track["resolvedAuthorGain"] = json!({"state":"unobserved"});
    let discovery: Value =
        serde_json::from_str(&resolve_hyperframes_audio_discovery_json(graph.to_string())).unwrap();
    assert!(discovery.get("error").is_none(), "{discovery}");
    let resource = |id: &str, kind: &str, mime: &str, prefix: &str| {
        json!({"id":id,"kind":kind,"mimeType":mime,"byteLength":100,
            "sha256":"b".repeat(64),"attachmentKey":format!("{prefix}{}", "b".repeat(64))})
    };
    json!({"graph":graph,"seek":discovery["plan"]["seeks"][0],"source":{
        "version":1,"runtime":"html-document","code":"","documentId":"build.html",
        "width":64,"height":64,"frameRate":{"numerator":25,"denominator":1},
        "durationFrames":8,"seed":17,"audio":{"version":1,"mode":"native"},
        "resources":[resource("build.html","document","text/html","programmatic-sha256-")],
        "build":{"version":1,"engine":"hyperframes","engineVersion":"0.8.139",
            "entryFile":"index.html",
            "inputs":[resource("index.html","source","application/octet-stream","programmatic-source-sha256-")],
            "toolchainLock":resource("_rocut/toolchain-lock.json","source","application/octet-stream","programmatic-source-sha256-")}}})
}

fn resolve(input: &Value) -> Value {
    serde_json::from_str(&resolve_hyperframes_audio_seek_json(input.to_string())).unwrap()
}

fn rejected(input: &Value) {
    let result = resolve(input);
    assert!(result["error"].is_string(), "{result}");
    assert!(result.get("frame").is_none(), "{result}");
}

#[test]
fn exact_native_seconds_survive_with_integer_picture_context_and_decoder_policy() {
    let input = input();
    let result = resolve(&input);
    assert!(result.get("error").is_none(), "{result}");
    assert_eq!(result["seek"], input["seek"]);
    assert_eq!(result["frame"]["time"], input["seek"]["time"]);
    assert!((result["frame"]["time"].as_f64().unwrap() - 0.102).abs() < 1e-15);
    assert_eq!(result["frame"]["index"], 2);
    assert_eq!(result["frame"]["sourceTime"].as_u64(), Some(9600));
    assert_eq!(result["frame"]["timelineTime"].as_u64(), Some(9600));
    assert_eq!(result["frame"]["seed"], 17);
    assert_eq!(result["frame"]["durationFrames"], 8);
    assert_eq!(result["frame"]["frameRate"], input["graph"]["frameRate"]);
    assert!(result["frame"]["videoLimits"]["maxBytes"].as_u64().unwrap() > 0);
    assert_ne!(result["frame"]["time"], json!(2.0 / 25.0));
}

#[test]
fn discovery_native_time_is_not_rounded_to_integer_ticks_or_samples() {
    let mut input = input();
    input["graph"]["snapshot"]["tracks"][0]["native"]["start"] = json!(0.101123456);
    input["graph"]["snapshot"]["tracks"][0]["native"]["end"] = json!(0.103123456);
    let discovery: Value = serde_json::from_str(&resolve_hyperframes_audio_discovery_json(
        input["graph"].to_string(),
    ))
    .unwrap();
    input["seek"] = discovery["plan"]["seeks"][0].clone();
    let result = resolve(&input);
    assert!(result.get("error").is_none(), "{result}");
    let time = result["frame"]["time"].as_f64().unwrap();
    assert_eq!(result["frame"]["time"], input["seek"]["time"]);
    assert_ne!((time * 120_000.0).round() / 120_000.0, time);
    assert_ne!((time * 48_000.0).round() / 48_000.0, time);
}

#[test]
fn browser_number_roundtrip_preserves_the_exact_discovery_f64() {
    let mut input = input();
    // JS/native end = start + duration, not the decimal author literal 0.103.
    input["graph"]["snapshot"]["tracks"][0]["native"]["end"] = json!(0.101 + 0.002);
    let expected = 0.10200000000000001_f64;
    input["seek"]["time"] = json!(expected);
    let result = resolve(&input);
    assert!(result.get("error").is_none(), "{result}");
    assert_eq!(
        result["frame"]["time"].as_f64().unwrap().to_bits(),
        expected.to_bits()
    );
    assert_eq!(
        result["seek"]["time"].as_f64().unwrap().to_bits(),
        expected.to_bits()
    );
}

#[test]
fn rejects_outside_composition_wrong_instances_and_non_discovery_times() {
    let base = input();
    for time in [
        json!(-0.001),
        json!(0.32),
        json!(10),
        json!(0.08),
        json!(0.1021),
    ] {
        let mut input = base.clone();
        input["seek"]["time"] = time;
        rejected(&input);
    }
    for ids in [
        json!([]),
        json!(["voice"]),
        json!(["missing"]),
        json!(["track#1", "track#1"]),
    ] {
        let mut input = base.clone();
        input["seek"]["instanceIds"] = ids;
        rejected(&input);
    }
}

#[test]
fn refuses_invalid_numbers_and_unknown_fields_without_a_descriptor() {
    let base = input();
    for value in [Value::Null, json!("NaN"), json!("Infinity")] {
        let mut input = base.clone();
        input["seek"]["time"] = value;
        rejected(&input);
    }
    let raw = base.to_string().replace("\"time\":0.102", "\"time\":NaN");
    let result: Value = serde_json::from_str(&resolve_hyperframes_audio_seek_json(raw)).unwrap();
    assert!(result["error"].is_string(), "{result}");
    let mut unknown = base;
    unknown["seek"]["roundedFrame"] = json!(2);
    rejected(&unknown);
}

#[test]
fn validates_source_clock_native_mode_and_full_graph_identity() {
    let base = input();
    for (path, value) in [
        ("/source/frameRate/numerator", json!(30)),
        ("/source/durationFrames", json!(9)),
        ("/source/audio/mode", json!("none")),
        ("/source/audio", Value::Null),
        ("/source/build/engine", json!("remotion")),
        ("/source/build/engineVersion", json!("0.8.138")),
        ("/source/width", json!(0)),
        ("/graph/snapshot/tracks/0/instanceId", json!("changed")),
        ("/graph/snapshot/tracks/0/resourceId", json!("c".repeat(64))),
        (
            "/graph/snapshot/tracks/0/attributes/groupRenderId",
            json!("missing"),
        ),
        (
            "/graph/snapshot/tracks/0/attributes/fxChain",
            json!("invalid"),
        ),
        ("/graph/sources/0/byteLength", json!(128 * 1024 * 1024)),
    ] {
        let mut input = base.clone();
        *input.pointer_mut(path).unwrap() = value;
        rejected(&input);
    }
}
