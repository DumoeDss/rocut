use editor_api::{resolve_programmatic_frame_json, validate_clip_editing_json};
use serde_json::{Value, json};

fn source() -> Value {
    json!({"version":1,"runtime":"canvas-worker","code":"canvas.getContext('2d').fillRect(frame.index,0,4,4)",
        "width":64,"height":32,"frameRate":{"numerator":30000,"denominator":1001},"durationFrames":100,"seed":42})
}
fn frame(time: u64) -> Value {
    serde_json::from_str(&resolve_programmatic_frame_json(json!({
        "source":source(),"clipStart":120000,"clipDuration":120000,"trimStart":4004,"timelineTime":time
    }).to_string())).unwrap()
}

#[test]
fn half_open_trimmed_rational_frames_and_random_seek() {
    assert!(frame(119999)["frame"].is_null());
    assert!(frame(240000)["frame"].is_null());
    for (time, index) in [
        (120000, 1),
        (124003, 1),
        (124004, 2),
        (239999, 30),
        (120000, 1),
    ] {
        let f = frame(time);
        assert_eq!(f["frame"]["index"], index);
        assert_eq!(f["frame"]["sourceTime"], index * 4004);
        assert_eq!(f["frame"]["timelineTime"], time);
    }
    assert_eq!(frame(124004), frame(124004));
}

fn request() -> Value {
    json!({"editing":{"type":"graphic","definitionId":"programmatic","params":{},"programmatic":source()},
        "duration":120000,"trimStart":4004,"trackKind":"graphic","hasMotionText":false,"hasAdjustment":false,
        "catalog":{"elements":{"graphic":[]},"graphics":{"programmatic":[]},"effects":{},"masks":{}}})
}
fn valid(r: Value) -> bool {
    serde_json::from_str::<Vec<Value>>(&validate_clip_editing_json(r.to_string()))
        .unwrap()
        .is_empty()
}

#[test]
fn source_schema_limits_and_lane_semantics() {
    assert!(valid(request()));
    let mut html = request();
    html["editing"]["programmatic"]["runtime"] = json!("html-document");
    html["editing"]["programmatic"]["code"] = json!("<div>HTML source</div>");
    assert!(valid(html));
    for (field, value) in [
        ("version", json!(2)),
        ("runtime", json!("remotion")),
        ("width", json!(4097)),
        ("height", json!(0)),
        ("seed", json!(-1)),
        ("durationFrames", json!(0)),
        ("code", json!(" ")),
        ("unknown", json!(true)),
        ("frameRate", json!({"numerator":90,"denominator":1})),
    ] {
        let mut r = request();
        r["editing"]["programmatic"][field] = value;
        assert!(!valid(r), "must reject {field}");
    }
    for (field, value) in [
        ("type", json!("text")),
        ("definitionId", json!("rectangle")),
        ("programmatic", Value::Null),
    ] {
        let mut r = request();
        r["editing"][field] = value;
        assert!(!valid(r));
    }
    let mut r = request();
    r["trimStart"] = json!(400400);
    assert!(!valid(r));
    let mut r = request();
    r["editing"]["programmatic"]["code"] = json!("x".repeat(262145));
    assert!(!valid(r));
    let mut r = request();
    r["editing"]["programmatic"]["frameRate"] = json!({"numerator":1,"denominator":u32::MAX});
    r["editing"]["programmatic"]["durationFrames"] = json!(u32::MAX);
    assert!(!valid(r)); // malformed limits must not overflow before rejection
}

#[test]
fn invalid_ranges_do_not_wrap_or_render_a_stale_frame() {
    for (key, value) in [
        ("trimStart", json!(400400)),
        ("timelineTime", json!(-1)),
        ("timelineTime", json!(9007199254740992u64)),
        ("clipDuration", json!(u64::MAX)),
    ] {
        let mut r = json!({"source":source(),"clipStart":0,"clipDuration":4004,"trimStart":0,"timelineTime":0});
        r[key] = value;
        let result: Value =
            serde_json::from_str(&resolve_programmatic_frame_json(r.to_string())).unwrap();
        assert!(result["error"].is_string(), "must reject {key}");
    }
}

#[test]
fn compiled_document_references_are_exclusive_bounded_and_html_only() {
    let mut r = request();
    let source = &mut r["editing"]["programmatic"];
    source["runtime"] = json!("html-document");
    source["code"] = json!("");
    source["documentId"] = json!("build/index.html");
    source["resources"] = json!([{
        "id":"build/index.html", "kind":"document", "mimeType":"text/html", "byteLength":700000,
        "sha256":"a".repeat(64),"attachmentKey":format!("programmatic-sha256-{}", "a".repeat(64))
    }]);
    assert!(valid(r.clone()));
    for (field, value) in [
        ("runtime", json!("canvas-worker")),
        ("documentId", json!("missing.html")),
        ("documentId", json!("")),
        ("documentId", Value::Null),
        ("code", json!("<div>ambiguous second source</div>")),
        ("code", json!(" ")),
        ("resources", json!([])),
    ] {
        let mut bad = r.clone();
        bad["editing"]["programmatic"][field] = value;
        assert!(!valid(bad), "accepted invalid {field}");
    }
    let mut oversized = r.clone();
    oversized["editing"]["programmatic"]["resources"][0]["byteLength"] = json!(16777217);
    assert!(!valid(oversized));
    r["editing"]["programmatic"]["resources"][0]["kind"] = json!("image");
    r["editing"]["programmatic"]["resources"][0]["mimeType"] = json!("image/png");
    assert!(!valid(r));
}
