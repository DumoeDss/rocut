use effects::{
    EffectPass, UniformValue, resolve_stylized_effect_json, stylized_effect_catalog_json,
    validate_effect_pass,
};
use serde_json::{Value, json};

#[test]
fn flame_wrap_public_catalog_and_resolution_contract() {
    let catalog: Value = serde_json::from_str(&stylized_effect_catalog_json()).unwrap();
    let entry = catalog
        .as_array()
        .unwrap()
        .iter()
        .find(|entry| entry["id"] == "flame-wrap")
        .unwrap();
    assert_eq!(entry["fields"].as_array().unwrap().len(), 9);
    let request = json!({"effectType":"flame-wrap","params":{},"localTime":-1,"frameRate":{"numerator":30000,"denominator":1001}});
    let plan: Value =
        serde_json::from_str(&resolve_stylized_effect_json(request.to_string())).unwrap();
    assert_eq!(plan["frameIndex"], -1);
    assert_eq!(plan["passes"][0]["shader"], "flame_wrap");
    for field in entry["fields"].as_array().unwrap() {
        assert_eq!(
            plan["passes"][0]["uniforms"][field["key"].as_str().unwrap()],
            field["default"]
        );
    }
}

fn resolve(params: Value, time: i64) -> Value {
    serde_json::from_str(&resolve_stylized_effect_json(json!({"effectType":"flame-wrap","params":params,"localTime":time,"frameRate":{"numerator":30000,"denominator":1001}}).to_string())).unwrap()
}

#[test]
fn flame_wrap_public_transport_has_neutral_and_signed_clock_contract() {
    assert_eq!(resolve(json!({}), -1), resolve(json!({}), -4004));
    assert_eq!(
        resolve(json!({"speed":0}), 0)["passes"],
        resolve(json!({"speed":0}), 9_007_199_254_740_991)["passes"]
    );
    assert_eq!(resolve(json!({"amount":0}), 0)["passes"], json!([]));
    assert_eq!(
        resolve(json!({"flameOpacity":0,"sparkOpacity":0,"refraction":0}), 0)["passes"],
        json!([])
    );
    for params in [
        json!({"seed":0.5}),
        json!({"boundaryWidth":0}),
        json!({"flameHeight":129}),
        json!({"phase":0}),
        json!({"wind":null}),
        json!({"speed":"0"}),
        json!({"amount":true}),
    ] {
        assert!(resolve(params, 0)["error"].is_string());
    }
    assert!(resolve(json!({}), 9_007_199_254_740_992)["error"].is_string());
}

#[test]
fn flame_wrap_public_pass_admission_checks_actual_budget_and_raw_uniforms() {
    let plan = resolve(json!({}), 0);
    let pass = EffectPass {
        shader: "flame_wrap".into(),
        uniforms: plan["passes"][0]["uniforms"]
            .as_object()
            .unwrap()
            .iter()
            .map(|(key, value)| {
                (
                    key.clone(),
                    UniformValue::Number(value.as_f64().unwrap() as f32),
                )
            })
            .collect(),
    };
    assert!(validate_effect_pass(&pass, [1920, 1080]).is_ok());
    assert!(validate_effect_pass(&pass, [8192, 8192]).is_err());
    let mut maximum = pass.clone();
    maximum
        .uniforms
        .insert("boundaryWidth".into(), UniformValue::Number(32.0));
    maximum
        .uniforms
        .insert("flameHeight".into(), UniformValue::Number(128.0));
    assert!(validate_effect_pass(&maximum, [8192, 1196]).is_ok());
    assert!(validate_effect_pass(&maximum, [8192, 1197]).is_err());
    for (key, value) in [
        ("phase", UniformValue::Number(1.0)),
        ("phase", UniformValue::Number(f32::NAN)),
        ("amount", UniformValue::Vector(vec![0.0])),
        ("seed", UniformValue::Number(0.5)),
        ("unknown", UniformValue::Number(0.0)),
    ] {
        let mut invalid = pass.clone();
        invalid.uniforms.insert(key.into(), value);
        assert!(validate_effect_pass(&invalid, [1, 1]).is_err());
    }
}
