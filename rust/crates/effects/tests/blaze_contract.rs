use effects::{resolve_stylized_effect_json, stylized_effect_catalog_json};
use serde_json::{Value, json};

fn resolve(params: Value, local_time: i64) -> Value {
    serde_json::from_str(&resolve_stylized_effect_json(
        json!({
            "effectType": "blaze", "params": params, "localTime": local_time,
            "frameRate": {"numerator": 30000, "denominator": 1001}
        })
        .to_string(),
    ))
    .unwrap()
}

#[test]
fn blaze_public_catalog_and_frame_plan_are_registered() {
    let catalog: Value = serde_json::from_str(&stylized_effect_catalog_json()).unwrap();
    let definition = catalog
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["id"] == "blaze")
        .unwrap();
    assert_eq!(definition["version"], 1);
    assert_eq!(definition["fields"].as_array().unwrap().len(), 10);
    let value = resolve(json!({}), -1);
    assert_eq!(value["frameIndex"], -1);
    assert_eq!(value["passes"][0]["shader"], "blaze");
    assert_eq!(value, resolve(json!({}), -4004));
    for field in definition["fields"].as_array().unwrap() {
        assert_eq!(
            value["passes"][0]["uniforms"][field["key"].as_str().unwrap()],
            field["default"]
        );
    }
}

#[test]
fn blaze_public_transport_rejects_malformed_params_instead_of_clamping() {
    for params in [
        json!({"amount": 1.01}),
        json!({"seed": 1.5}),
        json!({"height": 0}),
        json!({"phase": 0}),
        json!({"speed": null}),
        json!({"wind": "0"}),
        json!({"flameOpacity": true}),
    ] {
        assert!(resolve(params, 0)["error"].is_string());
    }
    assert_eq!(resolve(json!({"amount": 0}), 0)["passes"], json!([]));
    assert_eq!(
        resolve(
            json!({"flameOpacity": 0, "sparkOpacity": 0, "smokeOpacity": 0, "refraction": 0}),
            0
        )["passes"],
        json!([])
    );
}
