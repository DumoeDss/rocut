use effects::{
    resolve_stylized_effect_json, stylized_effect_catalog_json, validate_bubble_schedule,
};
use serde_json::{Value, json};

fn resolve(params: Value, local_time: i64) -> Value {
    serde_json::from_str(&resolve_stylized_effect_json(
        json!({
            "effectType": "bubble", "params": params, "localTime": local_time,
            "frameRate": {"numerator": 30000, "denominator": 1001}
        })
        .to_string(),
    ))
    .unwrap()
}

fn defaults() -> Value {
    let catalog: Value = serde_json::from_str(&stylized_effect_catalog_json()).unwrap();
    let definition = catalog
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["id"] == "bubble")
        .unwrap();
    let values = definition["fields"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|field| field["required"] != false)
        .map(|field| {
            (
                field["key"].as_str().unwrap().to_owned(),
                field["default"].clone(),
            )
        })
        .collect();
    Value::Object(values)
}

#[test]
fn bubble_public_catalog_has_materialized_point_zero_and_resolves_actual_source_effect() {
    let params = defaults();
    assert_eq!(params["point0Time"], 0.0);
    assert_eq!(params["point0X"], 0.5);
    assert_eq!(params["point0Y"], 0.5);
    assert!(params.get("point1Time").is_none());
    let result = resolve(params, 4004);
    assert_eq!(result["version"], 1);
    assert_eq!(result["frameIndex"], 1);
    assert_eq!(result["passes"][0]["shader"], "bubble");
    assert_eq!(result["passes"][0]["uniforms"]["ballCount"], 24.0);
    assert_eq!(result["passes"][0]["uniforms"]["center23X"], 0.5);
    assert!(result["passes"][0]["uniforms"].get("point0Time").is_none());
}

#[test]
fn bubble_public_transport_rejects_malformed_and_incomplete_schedules() {
    assert!(
        resolve(json!({}), 0)["error"]
            .as_str()
            .unwrap()
            .contains("Missing active")
    );
    for (key, value) in [
        ("point0X", Value::Null),
        ("point0Time", json!(0.1)),
        ("radius", json!(0)),
        ("point1Time", json!(0)),
        ("trail", json!(24.5)),
        ("follow", json!("0.5")),
        ("phase", json!(0)),
        ("pointCount", json!(2)),
    ] {
        let mut params = defaults();
        params[key] = value;
        assert!(resolve(params, 0)["error"].is_string(), "{key}");
    }
}

#[test]
fn bubble_public_identity_paths_keep_empty_passes_and_static_controls_still_validate() {
    let mut params = defaults();
    params["amount"] = json!(0);
    assert_eq!(resolve(params.clone(), 0)["passes"], json!([]));
    params["pointCount"] = json!(2);
    assert!(resolve(params, 0)["error"].is_string());
    assert_eq!(resolve(defaults(), -1)["passes"], json!([]));
    assert_eq!(resolve(defaults(), 240240)["passes"], json!([]));
    let mut params = defaults();
    for key in [
        "refraction",
        "frost",
        "shine",
        "rim",
        "iridescence",
        "tintStrength",
    ] {
        params[key] = json!(0);
    }
    assert_eq!(resolve(params, 0)["passes"], json!([]));
}

#[test]
fn bubble_admission_check_does_not_skip_invalid_zero_strength_schedule() {
    let mut params = defaults()
        .as_object()
        .unwrap()
        .iter()
        .map(|(key, value)| (key.clone(), value.as_f64().unwrap()))
        .collect::<std::collections::BTreeMap<_, _>>();
    assert!(validate_bubble_schedule(&params).is_ok());
    params.insert("amount".into(), 0.0);
    params.insert("pointCount".into(), 2.0);
    assert!(validate_bubble_schedule(&params).is_err());
}
