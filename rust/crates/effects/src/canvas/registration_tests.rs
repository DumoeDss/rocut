use crate::{EffectPass, EffectsError, UniformValue};
use serde_json::{Value, json};
use std::collections::BTreeMap;

fn registered() -> Value {
    let catalog: Vec<Value> = serde_json::from_str(&crate::stylized_effect_catalog_json()).unwrap();
    let mut matching = catalog.into_iter().filter(|d| d["id"] == "canvas");
    let definition = matching.next().expect("Canvas is publicly registered");
    assert!(matching.next().is_none());
    definition
}

fn defaults() -> BTreeMap<String, f64> {
    registered()["fields"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|f| f["required"] == true)
        .map(|f| {
            (
                f["key"].as_str().unwrap().into(),
                f["default"].as_f64().unwrap(),
            )
        })
        .collect()
}

fn public_resolve(params: &BTreeMap<String, f64>, ticks: i64) -> Value {
    let request = json!({"effectType":"canvas", "params":params,
        "localTime":ticks, "frameRate":time::FrameRate::FPS_29_97});
    serde_json::from_str(&crate::resolve_stylized_effect_json(request.to_string())).unwrap()
}

fn pass(value: &Value) -> EffectPass {
    EffectPass {
        shader: value["shader"].as_str().unwrap().into(),
        uniforms: value["uniforms"]
            .as_object()
            .unwrap()
            .iter()
            .map(|(key, words)| {
                let words = words
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|v| v.as_f64().unwrap() as f32)
                    .collect();
                (key.clone(), UniformValue::Vector(words))
            })
            .collect(),
    }
}

#[test]
fn public_catalog_registers_static_canvas_without_inferred_amount() {
    let d = registered();
    assert_eq!(d["version"], 1);
    assert_eq!(d["animated"], true);
    assert_eq!(d["fields"].as_array().unwrap().len(), 190);
    assert!(
        d["fields"]
            .as_array()
            .unwrap()
            .iter()
            .all(|f| f["keyframable"] == false)
    );
    let p = defaults();
    assert_eq!(p.len(), 14);
    assert_eq!(p["version"], 1.0);
    assert_eq!(p["columns"], 32.0);
    assert_eq!(p["durationTicks"], 120000.0);
    assert!(!p.contains_key("amount"));
    crate::validate_canvas_schedule(&p).unwrap();
}

#[test]
fn public_dispatch_and_input_preflight_preserve_lossless_parameters() {
    let mut p = defaults();
    p.insert("drying".into(), 1.010203040506);
    p.insert("relief".into(), 0.1234567890123);
    p.insert("lightX".into(), -0.0);
    let output = public_resolve(&p, 16015);
    assert!(output.get("error").is_none(), "{output}");
    assert_eq!(output["frameIndex"], 3);
    let active = pass(&output["passes"][0]);
    crate::validate_effects_input(16, 12, 4096, std::slice::from_ref(&active)).unwrap();
    let decoded = crate::decode_canvas_pass(&active).unwrap();
    assert_eq!(decoded.sampled_ticks(), 12012);
    for (key, value) in p {
        assert_eq!(
            decoded.parameters()[&key].to_bits(),
            value.to_bits(),
            "{key}"
        );
    }
}

#[test]
fn public_dispatch_never_fills_defaults_or_bypasses_negative_schedule() {
    let p = defaults();
    let negative = public_resolve(&p, -1);
    assert_eq!(negative["frameIndex"], -1);
    assert_eq!(negative["passes"], json!([]));
    for ticks in [-1, 16015] {
        for key in p.keys() {
            let mut invalid = p.clone();
            invalid.remove(key);
            assert!(
                public_resolve(&invalid, ticks)["error"].is_string(),
                "{key}"
            );
        }
        let mut invalid = p.clone();
        invalid.insert("amount".into(), 0.0);
        assert!(public_resolve(&invalid, ticks)["error"].is_string());
    }
}

#[test]
fn input_preflight_reports_canvas_decode_and_global_dimension_errors() {
    let output = public_resolve(&defaults(), 16015);
    let mut active = pass(&output["passes"][0]);
    active
        .uniforms
        .insert("version".into(), UniformValue::Number(1.0));
    assert!(matches!(
        crate::validate_effects_input(16, 12, 4096, std::slice::from_ref(&active)),
        Err(EffectsError::CanvasPreparation { .. })
    ));
    assert!(matches!(
        crate::validate_effects_input(0, 12, 4096, &[active]),
        Err(EffectsError::InvalidInputDimensions { .. })
    ));
}
