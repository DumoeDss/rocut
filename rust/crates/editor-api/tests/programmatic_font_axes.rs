use editor_api::{resolve_programmatic_frame_json, validate_programmatic_resources_json};
use serde_json::{Map, Value, json};

fn font() -> Value {
    json!({"id":"fixture.ttf","kind":"font","mimeType":"font/ttf","byteLength":100,
        "sha256":"a".repeat(64),"attachmentKey":format!("programmatic-sha256-{}", "a".repeat(64)),
        "font":{"family":"VariableFixture","style":"normal","weight":400}})
}

fn valid(resource: Value) -> bool {
    serde_json::from_str::<Vec<Value>>(&validate_programmatic_resources_json(
        json!([resource]).to_string(),
    ))
    .unwrap()
    .is_empty()
}

#[test]
fn arbitrary_axes_are_structured_optional_and_bounded() {
    assert!(valid(font()));
    for axes in [
        json!({}),
        json!({"wght":725.5,"wdth":87.5,"opsz":32,"GRAD":-0.25,"XTRA":0}),
        json!({"A\"\\Z":2.5," ~ !":-1e30}),
    ] {
        let mut resource = font();
        resource["font"]["axes"] = axes;
        assert!(valid(resource));
    }
    for axes in [
        Value::Null,
        json!([]),
        json!("\"wdth\" 75"),
        json!({"wdth":"75"}),
        json!({"wdth":null}),
        json!({"wdth":true}),
        json!({"wdt":75}),
        json!({"width":75}),
        json!({"éé":75}),
        json!({"wd\nt":75}),
        json!({"wd\u{7f}t":75}),
    ] {
        let mut resource = font();
        resource["font"]["axes"] = axes;
        assert!(!valid(resource));
    }
    let mut resource = font();
    let mut axes = Map::new();
    for n in 0..64 {
        axes.insert(format!("X{n:03}"), json!(n));
    }
    resource["font"]["axes"] = json!(axes);
    assert!(valid(resource.clone()));
    resource["font"]["axes"]["X064"] = json!(64);
    assert!(!valid(resource));
    // JSON numeric overflow cannot enter the descriptor as an infinite f64.
    let raw = json!([font()])
        .to_string()
        .replace("\"weight\":400", "\"weight\":400,\"axes\":{\"XTRA\":1e999}");
    assert!(
        !serde_json::from_str::<Vec<Value>>(&validate_programmatic_resources_json(raw))
            .unwrap()
            .is_empty()
    );
}

#[test]
fn axes_do_not_make_ambiguous_css_faces_or_bypass_frame_validation() {
    let mut first = font();
    first["font"]["axes"] = json!({"XTRA":1});
    let mut second = first.clone();
    second["id"] = json!("second.ttf");
    second["font"]["axes"] = json!({"XTRA":2});
    let issues: Vec<Value> = serde_json::from_str(&validate_programmatic_resources_json(
        json!([first.clone(), second]).to_string(),
    ))
    .unwrap();
    assert!(!issues.is_empty());
    for runtime in ["canvas-worker", "html-document"] {
        let mut request = json!({"source":{"version":1,"runtime":runtime,"code":"void 0",
            "width":64,"height":64,"frameRate":{"numerator":30,"denominator":1},
            "durationFrames":30,"seed":7,"resources":[first]},
            "clipStart":0,"clipDuration":120000,"trimStart":0,"timelineTime":8000});
        let result: Value =
            serde_json::from_str(&resolve_programmatic_frame_json(request.to_string())).unwrap();
        assert_eq!(result["frame"]["index"], 2);
        request["source"]["resources"][0]["font"]["axes"] = json!({"invalid":1});
        let result: Value =
            serde_json::from_str(&resolve_programmatic_frame_json(request.to_string())).unwrap();
        assert!(result["error"].is_string());
    }
}
