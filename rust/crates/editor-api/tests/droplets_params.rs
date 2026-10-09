use editor_api::validate_clip_editing_json;
use serde_json::{Value, json};

fn request(layer: bool) -> Value {
    let catalog: Vec<Value> =
        serde_json::from_str(&effects::stylized_effect_catalog_json()).unwrap();
    let fields = catalog.iter().find(|d| d["id"] == "droplets").unwrap()["fields"]
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
        json!({"type":"effect","effectType":"droplets","params":params})
    } else {
        json!({"type":"text","params":{},"effects":[{
            "id":"rain","type":"droplets","enabled":true,"params":params
        }]})
    };
    json!({"editing":editing,"duration":240000,
        "trackKind":if layer {"effect"} else {"text"},
        "hasMotionText":false,"hasAdjustment":false,
        "catalog":{"elements":{},"graphics":{},"masks":{},
            "effects":{"droplets":definitions}}})
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
fn clip_and_layer_reject_invalid_droplets_even_when_inactive() {
    for layer in [false, true] {
        let baseline = request(layer);
        assert!(issues(&baseline).is_empty(), "{:?}", issues(&baseline));
        for (inactive_key, inactive_value) in [("amount", 0), ("count", 0)] {
            let mut inactive = baseline.clone();
            params(&mut inactive, layer)[inactive_key] = json!(inactive_value);
            assert!(issues(&inactive).is_empty());
            for (key, value) in [
                ("count", json!(1.5)),
                ("count", json!(65)),
                ("seed", json!(1.5)),
                ("seed", json!(65536)),
                ("radius", json!(0.002)),
                ("radius", json!(0.151)),
                ("speed", json!(-0.01)),
                ("speed", json!(4.01)),
                ("elongation", json!(0.9)),
                ("elongation", json!(4.1)),
                ("refraction", json!(0.101)),
                ("highlight", json!(1.1)),
                ("amount", json!(1.1)),
                ("seed", Value::Null),
                ("speed", json!("1")),
                ("phase", json!(0.5)),
                ("unknown", json!(1)),
            ] {
                let mut invalid = inactive.clone();
                params(&mut invalid, layer)[key] = value;
                assert!(
                    !issues(&invalid).is_empty(),
                    "accepted layer={layer}, inactive={inactive_key}, invalid={key}"
                );
            }
        }
        for (key, values) in [
            ("count", [0.0, 64.0]),
            ("seed", [0.0, 65535.0]),
            ("speed", [0.0, 4.0]),
            ("radius", [0.003, 0.15]),
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
fn only_optics_are_keyframable_and_require_static_fallback() {
    let baseline = request(false);
    for (key, value, allowed) in [
        ("amount", 0.5, true),
        ("refraction", 0.05, true),
        ("highlight", 0.5, true),
        ("count", 32.0, false),
        ("seed", 2.0, false),
        ("radius", 0.05, false),
        ("speed", 0.5, false),
        ("elongation", 2.0, false),
    ] {
        let mut animated = baseline.clone();
        animated["editing"]["animations"] = json!({format!("effects.rain.params.{key}"):{"keys":[{
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
