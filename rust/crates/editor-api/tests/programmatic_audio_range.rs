use editor_api::resolve_programmatic_audio_range_json;
use serde_json::{Value, json};

fn request() -> Value {
    json!({"version":1,"frameRate":{"numerator":30000,"denominator":1001},
        "sampleRate":44100,"durationFrames":60,"firstFrame":1,"frameCount":30})
}
fn resolve(r: Value) -> Value {
    serde_json::from_str(&resolve_programmatic_audio_range_json(r.to_string())).unwrap()
}

#[test]
fn range_preserves_absolute_rational_sample_phase_before_collection() {
    let p = resolve(request());
    assert_eq!(p["plan"]["sampleOrigin"], 1471);
    assert_eq!(p["plan"]["outputFrames"], 44144);
    assert_eq!(p["plan"]["ticksPerFrame"], 4004);
    let mut r = request();
    r["firstFrame"] = json!(59);
    r["frameCount"] = json!(1);
    assert!(resolve(r).get("error").is_none());
}

#[test]
fn invalid_or_excessive_work_is_rejected_before_browser_collection() {
    for (key, value) in [
        ("version", json!(2)),
        ("frameCount", json!(0)),
        ("frameCount", json!(60)),
        ("firstFrame", json!(-1)),
        ("firstFrame", json!(1.5)),
        ("durationFrames", json!(1_000_001)),
        ("sampleRate", json!(96000)),
        ("frameRate", json!({"numerator":0,"denominator":1})),
        ("frameRate", json!({"numerator":29,"denominator":1})),
        ("frameRate", json!({"numerator":120001,"denominator":1})),
    ] {
        let mut r = request();
        r[key] = value;
        assert!(resolve(r).get("error").is_some(), "{key}");
    }
    let mut r = request();
    r["durationFrames"] = json!(1_000_000);
    r["frameCount"] = json!(36_001);
    r["frameRate"] = json!({"numerator":120000,"denominator":1});
    assert!(resolve(r.clone()).get("error").is_some()); // Many frames despite tiny PCM.
    r["frameCount"] = json!(12000);
    r["frameRate"] = json!({"numerator":30,"denominator":1});
    assert!(resolve(r).get("error").is_some()); // PCM budget despite bounded frame count.
}
