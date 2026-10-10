use editor_api::validate_clip_editing_json;
use serde_json::{Value, json};

fn request(layer: bool) -> Value {
    let catalog: Vec<Value> =
        serde_json::from_str(&effects::stylized_effect_catalog_json()).unwrap();
    let fields = catalog.iter().find(|d| d["id"] == "blaze").unwrap()["fields"]
        .as_array()
        .unwrap();
    let definitions: Vec<_> = fields
        .iter()
        .map(|field| {
            let mut definition = field.clone();
            definition["type"] = json!("number");
            definition
        })
        .collect();
    let params: serde_json::Map<String, Value> = fields
        .iter()
        .map(|field| {
            (
                field["key"].as_str().unwrap().into(),
                field["default"].clone(),
            )
        })
        .collect();
    let editing = if layer {
        json!({"type":"effect","effectType":"blaze","params":params})
    } else {
        json!({"type":"text","params":{},"effects":[{"id":"fire","type":"blaze","enabled":true,"params":params}]})
    };
    json!({"editing":editing,"duration":240000,"trackKind":if layer {"effect"} else {"text"},
        "hasMotionText":false,"hasAdjustment":false,
        "catalog":{"elements":{},"graphics":{},"masks":{},"effects":{"blaze":definitions}}})
}

fn params(request: &mut Value, layer: bool) -> &mut Value {
    if layer {
        &mut request["editing"]["params"]
    } else {
        &mut request["editing"]["effects"][0]["params"]
    }
}

fn issues(request: &Value) -> Vec<Value> {
    serde_json::from_str(&validate_clip_editing_json(request.to_string())).unwrap()
}

#[test]
fn blaze_clip_and_layer_validate_before_neutral_elision() {
    for layer in [false, true] {
        let baseline = request(layer);
        assert!(issues(&baseline).is_empty());
        for neutral in [
            json!({"amount":0}),
            json!({"flameOpacity":0,"sparkOpacity":0,"smokeOpacity":0,"refraction":0}),
        ] {
            let mut inactive = baseline.clone();
            params(&mut inactive, layer)
                .as_object_mut()
                .unwrap()
                .extend(neutral.as_object().unwrap().clone());
            assert!(issues(&inactive).is_empty());
            for (key, value) in [
                ("seed", json!(1.5)),
                ("seed", json!(65536)),
                ("amount", json!(1.01)),
                ("flameOpacity", json!(-0.01)),
                ("sparkOpacity", json!(1.01)),
                ("smokeOpacity", json!(1.01)),
                ("height", json!(0.099)),
                ("height", json!(1.501)),
                ("scale", json!(0.024)),
                ("scale", json!(0.501)),
                ("speed", json!(-0.01)),
                ("speed", json!(4.01)),
                ("wind", json!(-1.01)),
                ("wind", json!(1.01)),
                ("refraction", json!(0.081)),
                ("seed", Value::Null),
                ("speed", json!("1")),
                ("phase", json!(0.5)),
                ("sparkCount", json!(12)),
                ("mask", json!(1)),
            ] {
                let mut invalid = inactive.clone();
                params(&mut invalid, layer)[key] = value;
                assert!(
                    !issues(&invalid).is_empty(),
                    "accepted layer={layer}, neutral={neutral}, key={key}"
                );
            }
        }
        for (key, values) in [
            ("amount", [0.0, 1.0]),
            ("flameOpacity", [0.0, 1.0]),
            ("sparkOpacity", [0.0, 1.0]),
            ("smokeOpacity", [0.0, 1.0]),
            ("seed", [0.0, 65535.0]),
            ("height", [0.1, 1.5]),
            ("scale", [0.025, 0.5]),
            ("speed", [0.0, 4.0]),
            ("wind", [-1.0, 1.0]),
            ("refraction", [0.0, 0.08]),
        ] {
            for value in values {
                let mut valid = baseline.clone();
                params(&mut valid, layer)[key] = json!(value);
                assert!(issues(&valid).is_empty(), "boundary {key}={value}");
            }
        }
    }
}

#[test]
fn blaze_seven_animation_channels_require_static_fallback() {
    for (key, value, allowed) in [
        ("amount", 0.5, true),
        ("flameOpacity", 0.5, true),
        ("sparkOpacity", 0.5, true),
        ("smokeOpacity", 0.5, true),
        ("refraction", 0.02, true),
        ("height", 0.7, true),
        ("wind", -0.2, true),
        ("seed", 2.0, false),
        ("scale", 0.1, false),
        ("speed", 0.5, false),
    ] {
        let mut animated = request(false);
        animated["editing"]["animations"] = json!({format!("effects.fire.params.{key}"):{"keys":[{
            "id":"k0","time":0,"value":value,"segmentToNext":"linear","tangentMode":"auto"
        }]}});
        assert_eq!(
            issues(&animated).is_empty(),
            allowed,
            "{key}: {:?}",
            issues(&animated)
        );
        if allowed {
            params(&mut animated, false)
                .as_object_mut()
                .unwrap()
                .remove(key);
            assert!(
                !issues(&animated).is_empty(),
                "missing static {key} accepted"
            );
        }
    }
}

#[test]
fn blaze_effect_layer_does_not_accept_parameter_animation() {
    let mut layer = request(true);
    layer["editing"]["animations"] = json!({"params.flameOpacity":{"keys":[{
        "id":"k0","time":0,"value":0.5,"segmentToNext":"linear","tangentMode":"auto"
    }]}});
    assert!(!issues(&layer).is_empty());
}

#[test]
fn blaze_neutral_clip_still_rejects_invalid_animated_values() {
    for (key, values) in [
        ("amount", [-0.001, 1.001]),
        ("flameOpacity", [-0.001, 1.001]),
        ("sparkOpacity", [-0.001, 1.001]),
        ("smokeOpacity", [-0.001, 1.001]),
        ("refraction", [-0.001, 0.081]),
        ("height", [0.099, 1.501]),
        ("wind", [-1.001, 1.001]),
    ] {
        for value in [
            json!(values[0]),
            json!(values[1]),
            Value::Null,
            json!("0.5"),
        ] {
            let mut invalid = request(false);
            params(&mut invalid, false)["amount"] = json!(0);
            invalid["editing"]["animations"] = json!({format!("effects.fire.params.{key}"):{"keys":[{
                "id":"k0","time":0,"value":value,"segmentToNext":"linear","tangentMode":"auto"
            }]}});
            assert!(!issues(&invalid).is_empty(), "accepted {key}={value}");
        }
    }
}
