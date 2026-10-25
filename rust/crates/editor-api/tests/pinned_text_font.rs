use editor_api::resolve_pinned_text_font_json;
use editor_api::validate_clip_editing_json;
use serde_json::{Value, json};

fn descriptor() -> Value {
    json!({"id":"fonts/main.ttf","kind":"font","mimeType":"font/ttf","byteLength":100,
        "sha256":"a".repeat(64),"attachmentKey":format!("programmatic-sha256-{}", "a".repeat(64)),
        "font":{"family":"Fixture","style":"normal","weight":400}})
}
fn resolve(resource: Value, family: &str) -> Value {
    serde_json::from_str(&resolve_pinned_text_font_json(
        json!({"version":1,"value":resource.to_string(),"family":family}).to_string(),
    ))
    .unwrap()
}

#[test]
fn binds_static_font_to_immutable_project_attachment() {
    let result = resolve(descriptor(), "Fixture");
    assert_eq!(result["font"]["source"], "project");
    assert_eq!(result["font"]["assetId"], descriptor()["attachmentKey"]);
    assert_eq!(result["font"]["contentDigest"], descriptor()["sha256"]);
    assert!(
        resolve(descriptor(), "Another")["error"]
            .as_str()
            .unwrap()
            .contains("differs")
    );
}

#[test]
fn rejects_nonportable_unpinned_and_unsupported_font_descriptors() {
    for (key, value) in [
        ("id", json!("../escape")),
        ("kind", json!("image")),
        ("attachmentKey", json!("external.ttf")),
        ("byteLength", json!(0)),
        ("byteLength", json!(16 * 1024 * 1024 + 1)),
        ("mimeType", json!("font/woff2")),
        ("sha256", json!("A".repeat(64))),
        (
            "font",
            json!({"family":"Fixture","style":"normal","weight":400,"axes":{}}),
        ),
        (
            "font",
            json!({"family":"Fixture","style":"invalid","weight":400}),
        ),
    ] {
        let mut resource = descriptor();
        resource[key] = value;
        assert!(resolve(resource, "Fixture")["error"].is_string(), "{key}");
    }
}

#[test]
fn supports_absent_font_but_rejects_malformed_or_oversized_declarations() {
    for value in [json!("")] {
        let response: Value = serde_json::from_str(&resolve_pinned_text_font_json(
            json!({"version":1,"value":value}).to_string(),
        ))
        .unwrap();
        assert!(response["font"].is_null());
        assert!(response.get("error").is_none());
    }
    for value in [json!(null), json!("{"), json!(" ".repeat(4097)), json!({})] {
        let response: Value = serde_json::from_str(&resolve_pinned_text_font_json(
            json!({"version":1,"value":value}).to_string(),
        ))
        .unwrap();
        assert!(response["error"].is_string());
    }
}

#[test]
fn editing_admits_both_text_and_masks_and_reports_the_exact_resource_path() {
    let schema = json!([
        {"key":"fontFamily","type":"font"},
        {"key":"mv.fontResource","type":"text","required":false}
    ]);
    let mut request = json!({
        "editing":{"type":"text","params":{"fontFamily":"Fixture","mv.fontResource":descriptor().to_string()}},
        "duration":240000,"trackKind":"text","hasMotionText":false,"hasAdjustment":false,
        "catalog":{"elements":{"text":schema},"graphics":{"rectangle":[]},"effects":{},
            "masks":{"text":{"params":schema,"required":["fontFamily"]}}}
    });
    let check = |r: &Value| -> Vec<Value> {
        serde_json::from_str(&validate_clip_editing_json(r.to_string())).unwrap()
    };
    assert!(check(&request).is_empty());
    request["editing"]["params"]["fontFamily"] = json!("Changed");
    assert_eq!(check(&request)[0]["path"], "editing.params.mv.fontResource");
    request["editing"] = json!({"type":"graphic","definitionId":"rectangle","params":{},
        "masks":[{"id":"title-mask","type":"text","params":{"fontFamily":"Fixture","mv.fontResource":descriptor().to_string()}}]});
    request["trackKind"] = json!("graphic");
    assert!(check(&request).is_empty());
    request["editing"]["masks"][0]["params"]["mv.fontResource"] = json!("{bad json");
    assert_eq!(
        check(&request)[0]["path"],
        "editing.masks.title-mask.params.mv.fontResource"
    );
}
