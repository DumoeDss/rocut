use editor_api::{resolve_programmatic_frame_json, validate_programmatic_resources_json};
use serde_json::{Value, json};

fn resource(kind: &str, mime: &str) -> Value {
    json!({"id":format!("assets/{kind}"),"kind":kind,"mimeType":mime,"byteLength":256,
        "sha256":"a".repeat(64),"attachmentKey":format!("programmatic-sha256-{}", "a".repeat(64))})
}
fn valid(resources: Value) -> bool {
    serde_json::from_str::<Vec<Value>>(&validate_programmatic_resources_json(resources.to_string()))
        .unwrap()
        .is_empty()
}

#[test]
fn model_and_environment_manifests_keep_existing_attachment_limits() {
    for (kind, mime) in [
        ("model", "model/gltf-binary"),
        ("environment", "image/vnd.radiance"),
        ("environment", "image/x-exr"),
    ] {
        let value = resource(kind, mime);
        assert!(valid(json!([value.clone()])));
        for (field, bad) in [
            ("byteLength", json!(0)),
            ("byteLength", json!(16 * 1024 * 1024 + 1)),
            ("id", json!("../model.glb")),
            (
                "font",
                json!({"family":"bad","style":"normal","weight":400}),
            ),
        ] {
            let mut broken = value.clone();
            broken[field] = bad;
            assert!(
                !valid(json!([broken])),
                "accepted {kind} with invalid {field}"
            );
        }
        let too_many_bytes: Vec<_> = (0..5)
            .map(|index| {
                let mut next = value.clone();
                next["id"] = json!(format!("asset-{index}"));
                next["byteLength"] = json!(16 * 1024 * 1024);
                next
            })
            .collect();
        assert!(!valid(json!(too_many_bytes)));
    }
    for (kind, mime) in [
        ("model", "model/gltf+json"),
        ("model", "image/png"),
        ("environment", "image/png"),
        ("environment", "model/gltf-binary"),
        ("image", "image/x-exr"),
    ] {
        assert!(
            !valid(json!([resource(kind, mime)])),
            "accepted mismatched {kind}/{mime}"
        );
    }
}

#[test]
fn rust_supplies_bounded_decode_policy_only_for_three_resources() {
    for runtime in ["canvas-worker", "html-document"] {
        let mut request = json!({"source":{"version":1,"runtime":runtime,"code":"void 0","width":64,"height":64,
            "frameRate":{"numerator":30,"denominator":1},"durationFrames":30,"seed":7,
            "resources":[resource("model", "model/gltf-binary")]},
            "clipStart":0,"clipDuration":120000,"trimStart":0,"timelineTime":8000});
        let mapped: Value =
            serde_json::from_str(&resolve_programmatic_frame_json(request.to_string())).unwrap();
        assert_eq!(mapped["frame"]["index"], 2);
        assert_eq!(
            mapped["frame"]["resourceLimits"],
            json!({"maxBytes":16777216,"maxDecodedBytes":134217728,"maxDimension":8192,"maxObjects":100000})
        );
        request["source"]["resourceLimits"] = json!({"maxDecodedBytes":1073741824});
        let rejected: Value =
            serde_json::from_str(&resolve_programmatic_frame_json(request.to_string())).unwrap();
        assert!(
            rejected["error"].is_string(),
            "authored source cannot replace the policy"
        );
        request["source"]
            .as_object_mut()
            .unwrap()
            .remove("resourceLimits");
        request["source"]["resources"] = json!([]);
        let plain: Value =
            serde_json::from_str(&resolve_programmatic_frame_json(request.to_string())).unwrap();
        assert!(plain["frame"].get("resourceLimits").is_none());
    }
}
