use editor_api::resolve_programmatic_frame_json;
use serde_json::{Value, json};

fn input(id: &str) -> Value {
    json!({"id":id,"kind":"source","mimeType":"application/octet-stream","byteLength":0,
        "sha256":"a".repeat(64),"attachmentKey":format!("programmatic-source-sha256-{}", "a".repeat(64))})
}

#[test]
fn remotion_requires_composition_and_bounded_json_props() {
    let mut s = source();
    s["build"]["engine"] = json!("remotion");
    s["build"]["engineVersion"] = json!("4.0.440");
    s["build"]["compositionId"] = json!("Intro-示例");
    s["build"]["inputProps"] = json!({"title":"原创", "nested":[1,true,null]});
    assert!(valid(s.clone()));
    for id in [json!(""), json!("bad/id"), Value::Null, json!(42)] {
        let mut bad = s.clone();
        bad["build"]["compositionId"] = id;
        assert!(!valid(bad));
    }
    for props in [Value::Null, json!([]), json!({"large":"a".repeat(262144)})] {
        let mut bad = s.clone();
        bad["build"]["inputProps"] = props;
        assert!(!valid(bad));
    }
    s["build"]["engine"] = json!("hyperframes");
    assert!(!valid(s));
}

#[test]
fn three_build_uses_authoritative_limits_and_bounded_scene_props() {
    let mut s = source();
    s["build"]["engine"] = json!("three");
    s["build"]["engineVersion"] = json!("0.185.1");
    s["build"]["inputProps"] = json!({"color": "blue", "scale": 2});
    assert!(valid(s.clone()));
    let result: Value = serde_json::from_str(&resolve_programmatic_frame_json(
        json!({"source":s,"clipStart":0,"clipDuration":120000,"trimStart":0,"timelineTime":0})
            .to_string(),
    ))
    .unwrap();
    // Even a procedural scene with no GLB/environment must receive decoder policy.
    assert_eq!(result["frame"]["resourceLimits"]["maxBytes"], 16777216);
    for props in [Value::Null, json!([]), json!({"large":"a".repeat(262144)})] {
        let mut bad = s.clone();
        bad["build"]["inputProps"] = props;
        assert!(!valid(bad));
    }
    s["build"]["compositionId"] = json!("not-a-three-field");
    assert!(!valid(s));
}
fn source() -> Value {
    json!({"version":1,"runtime":"html-document","code":"","documentId":"build.html",
        "width":64,"height":64,"frameRate":{"numerator":30,"denominator":1},"durationFrames":60,"seed":1,
        "resources":[{"id":"build.html","kind":"document","mimeType":"text/html","byteLength":500000,
            "sha256":"b".repeat(64),"attachmentKey":format!("programmatic-sha256-{}", "b".repeat(64))}],
        "build":{"version":1,"engine":"hyperframes","engineVersion":"0.8.139","entryFile":"index.html",
            "inputs":[input("index.html"),input("empty.css")],"toolchainLock":input("_rocut/toolchain-lock.json")}})
}

#[test]
fn particle_capability_is_explicit_and_keeps_plain_three_compatible() {
    let mut s = source();
    s["build"]["engine"] = json!("three");
    s["build"]["engineVersion"] = json!("0.185.1");
    assert!(valid(s.clone()));
    s["build"]["capabilities"] = json!(["particle-surface-v1"]);
    assert!(valid(s.clone()));
    let roundtrip: Value = serde_json::from_str(&s.to_string()).unwrap();
    assert!(valid(roundtrip));
    s["build"]["engine"] = json!("hyperframes");
    assert!(!valid(s.clone()));
    s["build"]["engine"] = json!("remotion");
    s["build"]["compositionId"] = json!("Intro");
    assert!(!valid(s));
}

#[test]
fn particle_capability_rejects_malformed_unknown_and_duplicate_declarations() {
    for capabilities in [
        Value::Null,
        json!(false),
        json!(1),
        json!("particle-surface-v1"),
        json!({"particle-surface-v1": true}),
        json!([]),
        json!([null]),
        json!([1]),
        json!(["particle-surface-v2"]),
        json!(["Particle-surface-v1"]),
        json!(["particle-surface-v1", "particle-surface-v1"]),
        json!(["particle-surface-v1", "unknown"]),
        json!(["liquid-object-v2"]),
        json!(["liquid-object-v1", "liquid-object-v1"]),
        json!(["particle-surface-v1", "liquid-object-v1"]),
    ] {
        let mut s = source();
        s["build"]["engine"] = json!("three");
        s["build"]["engineVersion"] = json!("0.185.1");
        s["build"]["capabilities"] = capabilities.clone();
        assert!(!valid(s), "accepted capabilities {capabilities}");
    }
}

#[test]
fn liquid_object_capability_is_explicit_and_three_only() {
    let mut s = source();
    s["build"]["engine"] = json!("three");
    s["build"]["engineVersion"] = json!("0.185.1");
    s["build"]["capabilities"] = json!(["liquid-object-v1"]);
    assert!(valid(s.clone()));
    assert!(valid(serde_json::from_str(&s.to_string()).unwrap()));
    s["build"]["engine"] = json!("hyperframes");
    assert!(!valid(s.clone()));
    s["build"]["engine"] = json!("remotion");
    s["build"]["compositionId"] = json!("Intro");
    assert!(!valid(s));
}

fn valid(source: Value) -> bool {
    let result: Value = serde_json::from_str(&resolve_programmatic_frame_json(
        json!({
            "source":source,"clipStart":0,"clipDuration":120000,"trimStart":0,"timelineTime":0
        })
        .to_string(),
    ))
    .unwrap();
    result["frame"]["index"] == 0
}

#[test]
fn archives_are_bounded_portable_non_executable_render_inputs() {
    assert!(valid(source()));
    for id in [
        "../secret",
        "AUX.txt",
        "a/COM1.js",
        "node_modules/foo.js",
        "_rocut/index.html",
        "a.",
        ".git/config",
        "INDEX.html",
    ] {
        let mut s = source();
        s["build"]["inputs"][1] = input(id);
        assert!(!valid(s), "accepted {id}");
    }
    let mut collision = source();
    collision["build"]["inputs"][1] = input("index.html/child.js");
    assert!(!valid(collision));
    for (field, value) in [
        ("version", json!(2)),
        ("engine", json!("remotion")),
        ("engineVersion", json!("...")),
        ("entryFile", json!("missing.html")),
        ("inputs", json!([])),
        ("toolchainLock", Value::Null),
    ] {
        let mut s = source();
        s["build"][field] = value;
        assert!(!valid(s), "accepted {field}");
    }
    let mut s = source();
    s["build"] = Value::Null;
    assert!(!valid(s));
    let mut s = source();
    s["resources"] = json!([input("index.html")]);
    assert!(!valid(s));
    let mut s = source();
    s["build"]["inputs"][0]["byteLength"] = json!(16777217);
    assert!(!valid(s));
}
