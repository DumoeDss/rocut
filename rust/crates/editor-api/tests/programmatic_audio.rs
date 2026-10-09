use editor_api::{programmatic_audio_policy_json, resolve_remotion_audio_frame_json};
use serde_json::{Value, json};

fn request() -> Value {
    json!({"version":1,"frameIndex":23,"framesPerSecond":30,
        "sources":[{"id":"a".repeat(64),"mimeType":"audio/wav","byteLength":4096}],
        "assets":[{"id":"native-sequence","resourceId":"a".repeat(64),"type":"audio",
            "frame":23,"mediaFrame":24,"audioStartFrame":6,"playbackRate":2,
            "volume":0.25,"toneFrequency":1,"audioStreamIndex":0}]})
}
fn resolve(r: &Value) -> Value {
    serde_json::from_str(&resolve_remotion_audio_frame_json(r.to_string())).unwrap()
}

#[test]
fn native_trim_is_not_multiplied_by_rate_and_volume_is_preserved() {
    let mut r = request();
    let result = resolve(&r);
    assert!(result.get("error").is_none(), "{result}");
    assert_eq!(result["assets"][0]["sourceTime"], 1.4); // (6 + 18*2) / 30
    assert_eq!(result["assets"][0]["volume"], 0.25);
    r["assets"][0]["mediaFrame"] = json!(6);
    assert_eq!(resolve(&r)["assets"][0]["sourceTime"], 0.2); // native loop restart
    r["assets"][0]["mediaFrame"] = json!(9);
    r["assets"][0]["playbackRate"] = json!(0.5);
    r["assets"][0]["toneFrequency"] = json!(1.5);
    assert_eq!(resolve(&r)["assets"][0]["sourceTime"], 0.25);
    assert_eq!(resolve(&r)["assets"][0]["toneFrequency"], 1.5);
    r["assets"] = json!([]);
    assert_eq!(resolve(&r), json!({"assets":[]}));
}

#[test]
fn rejects_untrusted_schema_wrong_frames_sources_and_numeric_bounds() {
    for (key, value) in [
        ("frame", json!(22)),
        ("type", json!("artifact")),
        ("resourceId", json!("file:///secret.wav")),
        ("id", json!("")),
        ("mediaFrame", json!(5)),
        ("audioStartFrame", json!(-1)),
        ("playbackRate", json!(0)),
        ("playbackRate", json!(17)),
        ("volume", json!(-0.1)),
        ("volume", json!(65)),
        ("toneFrequency", json!(3)),
        ("audioStreamIndex", json!(32)),
        ("mediaFrame", json!(1e30)),
        ("volume", Value::Null),
        ("extra", json!(true)),
    ] {
        let mut r = request();
        r["assets"][0][key] = value;
        assert!(resolve(&r).get("error").is_some(), "accepted {key}: {r}");
    }
    for (key, value) in [
        ("version", json!(2)),
        ("frameIndex", json!(1_000_000)),
        ("framesPerSecond", json!(0)),
        ("framesPerSecond", json!(120_001)),
    ] {
        let mut r = request();
        r[key] = value;
        assert!(resolve(&r).get("error").is_some(), "accepted {r}");
    }
    let mut r = request();
    r["assets"] = json!([r["assets"][0], r["assets"][0]]);
    assert!(resolve(&r).get("error").is_some());
    r = request();
    r["sources"][0]["mimeType"] = json!("text/html");
    assert!(resolve(&r).get("error").is_some());
    r = request();
    r["sources"][0]["byteLength"] = json!(16 * 1024 * 1024 + 1);
    assert!(resolve(&r).get("error").is_some());
}

#[test]
fn audio_admission_has_its_own_limits_and_a_total_budget() {
    let policy: Value = serde_json::from_str(&programmatic_audio_policy_json()).unwrap();
    assert_eq!(policy["maxAssetsPerFrame"], 64);
    assert_eq!(policy["maxSourceBytes"], 16 * 1024 * 1024);
    let mut r = request();
    r["sources"] = json!(
        (0..5)
            .map(|i| json!({"id":format!("{i:064x}"),
        "mimeType":"audio/wav","byteLength":16*1024*1024}))
            .collect::<Vec<_>>()
    );
    r["assets"] = json!([]);
    assert!(
        resolve(&r)["error"]
            .as_str()
            .unwrap()
            .contains("total byte")
    );
}
