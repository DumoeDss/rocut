use editor_api::validate_clip_editing_json;
use serde_json::{Value, json};

fn request(layer: bool) -> Value {
    let catalog: Vec<Value> =
        serde_json::from_str(&effects::stylized_effect_catalog_json()).unwrap();
    let fields = catalog.iter().find(|d| d["id"] == "clouds").unwrap()["fields"]
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
        json!({"type":"effect","effectType":"clouds","params":params})
    } else {
        json!({"type":"text","params":{},"effects":[{"id":"fog","type":"clouds","enabled":true,"params":params}]})
    };
    json!({"editing":editing,"duration":240000,"trackKind":if layer {"effect"} else {"text"},
        "hasMotionText":false,"hasAdjustment":false,
        "catalog":{"elements":{},"graphics":{},"masks":{},"effects":{"clouds":definitions}}})
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
fn clouds_clip_and_layer_validate_inactive_parameters() {
    for layer in [false, true] {
        let baseline = request(layer);
        assert!(issues(&baseline).is_empty());
        for neutral in ["amount", "density"] {
            let mut inactive = baseline.clone();
            params(&mut inactive, layer)[neutral] = json!(0);
            assert!(issues(&inactive).is_empty());
            for (key, value) in [
                ("seed", json!(1.5)),
                ("seed", json!(65536)),
                ("amount", json!(1.01)),
                ("density", json!(-0.01)),
                ("scale", json!(0.049)),
                ("scale", json!(2.01)),
                ("speed", json!(-0.01)),
                ("speed", json!(4.01)),
                ("windX", json!(-16.01)),
                ("windY", json!(16.01)),
                ("refraction", json!(0.081)),
                ("fogOpacity", json!(1.01)),
                ("colorR", json!(-0.01)),
                ("colorG", json!(1.01)),
                ("colorB", Value::Null),
                ("seed", Value::Null),
                ("speed", json!("1")),
                ("phase", json!(0.5)),
                ("unknown", json!(1)),
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
            ("seed", [0.0, 65535.0]),
            ("scale", [0.05, 2.0]),
            ("speed", [0.0, 4.0]),
            ("windX", [-16.0, 16.0]),
            ("windY", [-16.0, 16.0]),
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
fn clouds_only_nine_channels_animate_and_require_static_fallback() {
    for (key, value, allowed) in [
        ("amount", 0.5, true),
        ("density", 0.5, true),
        ("windX", -0.2, true),
        ("windY", 0.2, true),
        ("refraction", 0.02, true),
        ("fogOpacity", 0.5, true),
        ("colorR", 0.2, true),
        ("colorG", 0.3, true),
        ("colorB", 0.4, true),
        ("seed", 2.0, false),
        ("scale", 0.5, false),
        ("speed", 0.5, false),
    ] {
        let mut animated = request(false);
        animated["editing"]["animations"] = json!({format!("effects.fog.params.{key}"):{"keys":[{
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
fn clouds_effect_layer_does_not_accept_parameter_animation() {
    let mut layer = request(true);
    layer["editing"]["animations"] = json!({"params.density":{"keys":[{
        "id":"k0","time":0,"value":0.5,"segmentToNext":"linear","tangentMode":"auto"
    }]}});
    assert!(!issues(&layer).is_empty());
}
