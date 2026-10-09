use editor_api::resolve_hyperframes_audio_frame_json;
use serde_json::{Value, json};

fn request() -> Value {
    json!({"version":1,"frameIndex":9,"framesPerSecond":30,
        "sources":[{"id":"a".repeat(64),"mimeType":"audio/wav","byteLength":4096}],
        "assets":[{"id":"nested-tone","resourceId":"a".repeat(64),"type":"audio",
            "time":0.3,"start":0.2,"end":0.5,"sourceDuration":2.0,
            "sourceTime":0.45,"playbackRate":2.0,"volume":1.5,"muted":false,"inWindow":true}]})
}

fn resolve(request: &Value) -> Value {
    serde_json::from_str(&resolve_hyperframes_audio_frame_json(request.to_string())).unwrap()
}

#[test]
fn preserves_native_nested_offset_loop_gain_and_rate_without_reinterpretation() {
    let mut r = request();
    let result = resolve(&r);
    assert!(result.get("error").is_none(), "{result}");
    assert_eq!(result["assets"][0]["sourceTime"], 0.45);
    assert_eq!(result["assets"][0]["playbackRate"], 2.0);
    assert_eq!(result["assets"][0]["volume"], 1.5);
    assert_eq!(result["assets"][0]["toneFrequency"], 1.0);
    r["assets"][0]["sourceTime"] = json!(0.1234567890123456);
    assert_eq!(
        resolve(&r)["assets"][0]["sourceTime"],
        r["assets"][0]["sourceTime"]
    );
}

#[test]
fn muted_outside_and_terminal_video_tail_are_not_replayed_as_audio() {
    for (key, value) in [
        ("muted", json!(true)),
        ("inWindow", json!(false)),
        ("sourceTime", json!(2.0)),
    ] {
        let mut r = request();
        r["assets"][0][key] = value;
        assert_eq!(resolve(&r), json!({"assets":[]}));
    }
    let mut r = request();
    r["assets"] = json!([]);
    assert_eq!(resolve(&r), json!({"assets":[]}));
}

#[test]
fn rejects_wrong_clock_unadmitted_bytes_and_invalid_native_fields() {
    for (key, value) in [
        ("time", json!(0.31)),
        ("start", json!(0.4)),
        ("end", json!(0.3)),
        ("sourceDuration", json!(0)),
        ("sourceDuration", json!(86401)),
        ("sourceTime", json!(-0.1)),
        ("sourceTime", Value::Null),
        ("resourceId", json!("file:///secret.wav")),
        ("type", json!("artifact")),
        ("playbackRate", json!(0)),
        ("playbackRate", json!(17)),
        ("volume", json!(-0.1)),
        ("volume", json!(65)),
        ("extra", json!(true)),
    ] {
        let mut r = request();
        r["assets"][0][key] = value;
        assert!(resolve(&r).get("error").is_some(), "accepted {key}: {r}");
    }
    let mut r = request();
    r["sources"][0]["byteLength"] = json!(16 * 1024 * 1024 + 1);
    assert!(resolve(&r).get("error").is_some());
    r = request();
    r["assets"] = json!([r["assets"][0], r["assets"][0]]);
    assert!(resolve(&r).get("error").is_some());
    r = request();
    r["framesPerSecond"] = json!(120001);
    assert!(resolve(&r).get("error").is_some());
}
