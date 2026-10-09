use editor_api::validate_clip_editing_json;
use serde_json::{Value, json};

fn request(layer: bool) -> Value {
    let params = json!({"amount":1,"seed":7});
    let editing = if layer {
        json!({"type":"effect","effectType":"ascii","params":params})
    } else {
        json!({"type":"text","params":{},"effects":[{
            "id":"style","type":"ascii","enabled":true,"params":params
        }]})
    };
    json!({
        "editing":editing,"duration":120000,
        "trackKind":if layer {"effect"} else {"text"},
        "hasMotionText":false,"hasAdjustment":false,
        "catalog":{"elements":{},"graphics":{},"masks":{},"effects":{"ascii":[
            {"key":"amount","type":"number","min":0,"max":1},
            {"key":"seed","type":"number","min":0,"max":65535,"required":true},
            {"key":"local","type":"number","min":0,"max":1,"required":false,"keyframable":false},
            {"key":"centerX","type":"number","min":-1,"max":2,"required":false}
        ]}}
    })
}

fn issues(request: &Value) -> Vec<Value> {
    serde_json::from_str(&validate_clip_editing_json(request.to_string())).unwrap()
}

fn params(request: &mut Value, layer: bool) -> &mut Value {
    if layer {
        &mut request["editing"]["params"]
    } else {
        &mut request["editing"]["effects"][0]["params"]
    }
}

#[test]
fn additive_controls_can_be_absent_on_visual_effects_and_effect_layers() {
    for layer in [false, true] {
        let mut r = request(layer);
        assert!(issues(&r).is_empty(), "{:?}", issues(&r));
        params(&mut r, layer)["local"] = json!(1);
        assert!(issues(&r).is_empty());
        params(&mut r, layer)["centerX"] = json!(0.3);
        assert!(issues(&r).is_empty());
        for key in ["amount", "seed"] {
            let mut missing = r.clone();
            params(&mut missing, layer)
                .as_object_mut()
                .unwrap()
                .remove(key);
            assert_eq!(issues(&missing).len(), 1, "{key}");
            assert!(
                issues(&missing)[0]["message"]
                    .as_str()
                    .unwrap()
                    .contains("Required")
            );
        }
    }
}

#[test]
fn optional_values_keep_type_range_and_unknown_field_validation() {
    for layer in [false, true] {
        for (key, value) in [
            ("centerX", json!(3)),
            ("centerX", json!("0.3")),
            ("centerX", Value::Null),
            ("local", json!(-1)),
            ("typo", json!(0)),
        ] {
            let mut r = request(layer);
            params(&mut r, layer)[key] = value;
            let errors = issues(&r);
            assert_eq!(errors.len(), 1, "{errors:?}");
            assert!(errors[0]["path"].as_str().unwrap().ends_with(key));
        }
    }
}

#[test]
fn animated_optional_controls_require_a_static_fallback_and_valid_keyframes() {
    let mut r = request(false);
    r["editing"]["animations"] = json!({"effects.style.params.centerX":{"keys":[{
        "id":"x0","time":0,"value":0.2,"segmentToNext":"linear","tangentMode":"auto"
    }]}});
    assert!(
        issues(&r)
            .iter()
            .any(|i| i["message"].as_str().unwrap().contains("fallback"))
    );
    params(&mut r, false)["centerX"] = json!(0.5);
    assert!(issues(&r).is_empty(), "{:?}", issues(&r));
    r["editing"]["animations"]["effects.style.params.centerX"]["keys"][0]["value"] = json!(3);
    assert!(!issues(&r).is_empty());
}
