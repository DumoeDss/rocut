use editor_api::{resolve_programmatic_frame_json, validate_programmatic_resources_json};
use serde_json::{Value, json};

fn image() -> Value {
    json!({"id":"images/card.png","kind":"image","mimeType":"image/png","byteLength":100,
        "sha256":"a".repeat(64),"attachmentKey":format!("programmatic-sha256-{}", "a".repeat(64))})
}
fn valid(resources: Value) -> bool {
    serde_json::from_str::<Vec<Value>>(&validate_programmatic_resources_json(resources.to_string()))
        .unwrap()
        .is_empty()
}

#[test]
fn validates_portable_content_addressed_resources() {
    assert!(valid(json!([])));
    assert!(valid(json!([image()])));
    for (field, value) in [
        ("id", json!("../private")),
        ("id", json!("a//b")),
        ("id", json!("/absolute")),
        ("id", json!("file:///private")),
        ("id", json!("a%2fb")),
        ("id", json!("a\\b")),
        ("attachmentKey", json!("../../private")),
        ("sha256", json!("A".repeat(64))),
        ("byteLength", json!(0)),
        ("byteLength", json!(16 * 1024 * 1024 + 1)),
        ("mimeType", json!("image/svg+xml")),
        ("kind", json!("script")),
        (
            "font",
            json!({"family":"Fixture","weight":400,"style":"normal"}),
        ),
        ("extra", json!(true)),
        ("font", Value::Null),
    ] {
        let mut r = image();
        r[field] = value;
        assert!(!valid(json!([r])), "accepted invalid {field}");
    }
    assert!(!valid(Value::Null));
    assert!(!valid(json!([image(), image()])));
    let resources: Vec<_> = (0..65)
        .map(|n| {
            let mut r = image();
            r["id"] = json!(format!("image{n}"));
            r
        })
        .collect();
    assert!(!valid(json!(resources)));
    let resources: Vec<_> = (0..5)
        .map(|n| {
            let mut r = image();
            r["id"] = json!(format!("image{n}"));
            r["byteLength"] = json!(16 * 1024 * 1024);
            r
        })
        .collect();
    assert!(!valid(json!(resources)));
}

#[test]
fn font_faces_are_explicit_and_unambiguous() {
    let mut font = image();
    font["kind"] = json!("font");
    font["mimeType"] = json!("font/ttf");
    font["font"] = json!({"family":"测试 Font","weight":400,"style":"normal"});
    assert!(valid(json!([font.clone()])));
    for (field, value) in [
        ("weight", json!(1001)),
        ("style", json!("oblique")),
        ("family", json!("bad;family")),
        ("family", json!("")),
    ] {
        let mut r = font.clone();
        r["font"][field] = value;
        assert!(!valid(json!([r])));
    }
    let mut second = font.clone();
    second["id"] = json!("font2");
    second["font"]["family"] = json!("测试 FONT");
    assert!(!valid(json!([font, second])));
}

#[test]
fn frame_mapping_enforces_manifest_policy_without_changing_timing() {
    let mut r = json!({"source":{"version":1,"runtime":"canvas-worker","code":"void 0","width":64,"height":64,
        "frameRate":{"numerator":30,"denominator":1},"durationFrames":30,"seed":7,"resources":[image()]},
        "clipStart":0,"clipDuration":120000,"trimStart":0,"timelineTime":8000});
    let mapped: Value =
        serde_json::from_str(&resolve_programmatic_frame_json(r.to_string())).unwrap();
    assert_eq!(mapped["frame"]["index"], 2);
    r["source"]["resources"][0]["id"] = json!("../escape");
    let mapped: Value =
        serde_json::from_str(&resolve_programmatic_frame_json(r.to_string())).unwrap();
    assert!(mapped["error"].is_string());
}

#[test]
fn video_resources_are_bounded_silent_html_inputs_not_worker_resources() {
    let mut video = image();
    video["kind"] = json!("video");
    video["mimeType"] = json!("video/webm");
    assert!(valid(json!([video.clone()])));
    video["mimeType"] = json!("video/mp4");
    assert!(valid(json!([video.clone()])));
    for mime in ["audio/webm", "video/quicktime", "application/octet-stream"] {
        let mut bad = video.clone();
        bad["mimeType"] = json!(mime);
        assert!(!valid(json!([bad])));
    }
    let mut request = json!({"source":{"version":1,"runtime":"html-document","code":"<p>video</p>",
        "width":64,"height":64,"frameRate":{"numerator":30,"denominator":1},
        "durationFrames":30,"seed":7,"resources":[video]},
        "clipStart":0,"clipDuration":120000,"trimStart":0,"timelineTime":8000});
    let result: Value =
        serde_json::from_str(&resolve_programmatic_frame_json(request.to_string())).unwrap();
    assert_eq!(
        result["frame"]["videoLimits"],
        json!({"maxBytes":16777216,"maxDimension":4096,"maxElements":16})
    );
    assert_eq!(result["frame"]["index"], 2);
    request["source"]["runtime"] = json!("canvas-worker");
    let result: Value =
        serde_json::from_str(&resolve_programmatic_frame_json(request.to_string())).unwrap();
    assert!(result["error"].as_str().unwrap().contains("html-document"));
    request["source"]["resources"] = json!([]);
    let result: Value =
        serde_json::from_str(&resolve_programmatic_frame_json(request.to_string())).unwrap();
    assert!(result["frame"].get("videoLimits").is_none());
}
