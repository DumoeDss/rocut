use editor_api::{validate_clip_editing_json, validate_master_effects_json};
use serde_json::{Value, json};

fn request(layer: bool) -> Value {
    let catalog: Vec<Value> =
        serde_json::from_str(&effects::stylized_effect_catalog_json()).unwrap();
    let fields = catalog
        .iter()
        .find(|entry| entry["id"] == "bubble")
        .unwrap()["fields"]
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
        .filter(|field| field["required"] != false)
        .map(|field| {
            (
                field["key"].as_str().unwrap().into(),
                field["default"].clone(),
            )
        })
        .collect();
    let editing = if layer {
        json!({"type":"effect","effectType":"bubble","params":params})
    } else {
        json!({"type":"text","params":{},"effects":[{"id":"lens","type":"bubble","enabled":true,"params":params}]})
    };
    json!({"editing":editing,"duration":240000,"trackKind":if layer {"effect"} else {"text"},
        "hasMotionText":false,"hasAdjustment":false,
        "catalog":{"elements":{},"graphics":{},"masks":{},"effects":{"bubble":definitions}}})
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

fn animation(key: &str, value: Value) -> Value {
    json!({format!("effects.lens.params.{key}"):{"keys":[{
        "id":"k0","time":0,"value":value,"segmentToNext":"linear","tangentMode":"auto"
    }]}})
}

#[test]
fn bubble_defaults_and_explicit_active_slots_are_valid_without_optional_slot_defaults() {
    for layer in [false, true] {
        let mut input = request(layer);
        assert!(issues(&input).is_empty());
        assert!(params(&mut input, layer).get("point1Time").is_none());
        params(&mut input, layer)["pointCount"] = json!(2);
        for (key, value) in [("point1Time", 120000.0), ("point1X", 0.9), ("point1Y", 0.1)] {
            params(&mut input, layer)[key] = json!(value);
        }
        assert!(issues(&input).is_empty(), "{:?}", issues(&input));
        for key in [
            "point0Time",
            "point0X",
            "point0Y",
            "point1Time",
            "point1X",
            "point1Y",
        ] {
            let mut missing = input.clone();
            params(&mut missing, layer)
                .as_object_mut()
                .unwrap()
                .remove(key);
            assert!(!issues(&missing).is_empty(), "missing {key}, layer={layer}");
        }
    }
}

#[test]
fn bubble_cross_field_schedule_errors_are_rejected_even_when_individual_fields_fit() {
    for layer in [false, true] {
        for neutral in [false, true] {
            let mut baseline = request(layer);
            if neutral {
                params(&mut baseline, layer)["amount"] = json!(0);
            }
            for changes in [
                json!({"point1X":0.5}),
                json!({"pointCount":2}),
                json!({"pointCount":2,"point1Time":0,"point1X":0.5,"point1Y":0.5}),
                json!({"pointCount":2,"point1Time":240001,"point1X":0.5,"point1Y":0.5}),
                json!({"startTicks":9007199254740991_u64}),
                json!({"trail":2.5}),
                json!({"pointCount":1.5}),
                json!({"startTicks":0.5}),
                json!({"durationTicks":240000.5}),
                json!({"trailDurationTicks":0.5}),
                json!({"pointCount":2,"point1Time":120000.5,"point1X":0.5,"point1Y":0.5}),
            ] {
                let mut invalid = baseline.clone();
                params(&mut invalid, layer)
                    .as_object_mut()
                    .unwrap()
                    .extend(changes.as_object().unwrap().clone());
                assert!(
                    !issues(&invalid).is_empty(),
                    "accepted {changes}, layer={layer}, neutral={neutral}"
                );
            }
        }
    }
}

#[test]
fn bubble_disabled_and_project_master_entries_are_still_checked() {
    let mut input = request(false);
    input["editing"]["effects"][0]["enabled"] = json!(false);
    assert!(issues(&input).is_empty());
    params(&mut input, false)["point15Time"] = json!(0);
    assert!(!issues(&input).is_empty());
    let master =
        json!({"effects":input["editing"]["effects"],"catalog":input["catalog"]["effects"]});
    let result: Vec<Value> =
        serde_json::from_str(&validate_master_effects_json(master.to_string())).unwrap();
    assert!(!result.is_empty());
}

#[test]
fn bubble_schema_errors_and_raw_prepared_fields_do_not_enter_authored_data() {
    for layer in [false, true] {
        for (key, value) in [
            ("point0X", Value::Null),
            ("point0Y", json!("0.5")),
            ("radius", json!(0.004)),
            ("blend", json!(24.01)),
            ("ior", json!(0.99)),
            ("refraction", json!(0.251)),
            ("frost", json!(-0.001)),
            ("phase", json!(0.5)),
            ("ballCount", json!(1)),
            ("center0X", json!(0.5)),
        ] {
            let mut input = request(layer);
            params(&mut input, layer)[key] = value.clone();
            assert!(
                !issues(&input).is_empty(),
                "accepted {key}={value}, layer={layer}"
            );
        }
    }
}

#[test]
fn bubble_optical_animation_requires_static_fallback_and_schedule_is_static() {
    for key in [
        "amount",
        "radius",
        "blend",
        "refraction",
        "ior",
        "dispersion",
        "frost",
        "shine",
        "rim",
        "iridescence",
        "intensity",
        "tintStrength",
        "tintR",
        "tintG",
        "tintB",
        "colorAR",
        "colorAG",
        "colorAB",
        "colorBR",
        "colorBG",
        "colorBB",
    ] {
        let mut input = request(false);
        let value = params(&mut input, false)[key].clone();
        input["editing"]["animations"] = animation(key, value);
        assert!(issues(&input).is_empty(), "{key}: {:?}", issues(&input));
        params(&mut input, false)
            .as_object_mut()
            .unwrap()
            .remove(key);
        assert!(
            !issues(&input).is_empty(),
            "missing animated fallback {key}"
        );
    }
    for key in [
        "speed",
        "follow",
        "trail",
        "trailDurationTicks",
        "startTicks",
        "durationTicks",
        "pointCount",
        "point0Time",
        "point0X",
        "point0Y",
    ] {
        let mut input = request(false);
        let value = params(&mut input, false)[key].clone();
        input["editing"]["animations"] = animation(key, value);
        assert!(!issues(&input).is_empty(), "animated schedule {key}");
    }
}

#[test]
fn bubble_effect_layer_extends_optical_animation_without_animating_schedule() {
    let mut input = request(true);
    input["editing"]["animations"] = json!({"params.radius":{"keys":[{
        "id":"k0","time":0,"value":0.1,"segmentToNext":"linear","tangentMode":"auto"
    }]}});
    assert!(issues(&input).is_empty(), "{:?}", issues(&input));
    input["editing"]["animations"] = json!({"params.point0Time":{"keys":[{
        "id":"k0","time":0,"value":0,"segmentToNext":"linear","tangentMode":"auto"
    }]}});
    assert!(!issues(&input).is_empty());
    // A supplied provider catalog cannot promote native static-only schedules.
    for field in input["catalog"]["effects"]["bubble"]
        .as_array_mut()
        .unwrap()
    {
        field["keyframable"] = json!(true);
    }
    assert!(!issues(&input).is_empty());
}
