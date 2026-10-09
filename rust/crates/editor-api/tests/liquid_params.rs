use editor_api::validate_clip_editing_json;
use serde_json::{Value, json};

fn request(layer: bool) -> Value {
    let catalog: Vec<Value> =
        serde_json::from_str(&effects::stylized_effect_catalog_json()).unwrap();
    let fields = catalog.iter().find(|d| d["id"] == "liquid").unwrap()["fields"]
        .as_array()
        .unwrap();
    let definitions: Vec<_> = fields
        .iter()
        .map(|field| {
            let mut p = field.clone();
            p["type"] = json!("number");
            p
        })
        .collect();
    let values: serde_json::Map<String, Value> = fields
        .iter()
        .filter(|f| f["required"] != false)
        .map(|f| (f["key"].as_str().unwrap().into(), f["default"].clone()))
        .collect();
    let editing = if layer {
        json!({"type":"effect","effectType":"liquid","params":values})
    } else {
        json!({"type":"text","params":{},"effects":[{"id":"fluid","type":"liquid","enabled":true,"params":values}]})
    };
    json!({"editing":editing,"duration":240000,"trackKind":if layer {"effect"} else {"text"},
        "hasMotionText":false,"hasAdjustment":false,
        "catalog":{"elements":{},"graphics":{},"masks":{},"effects":{"liquid":definitions}}})
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

fn impulse(request: &mut Value, layer: bool) {
    for (key, value) in [
        ("eventCount", 1.0),
        ("event0Time", 1000.0),
        ("event0X", 0.4),
        ("event0Y", 0.6),
        ("event0Radius", 0.3),
        ("event0VelocityX", 0.8),
        ("event0VelocityY", -0.3),
        ("event0Dye", 0.7),
    ] {
        params(request, layer)[key] = json!(value);
    }
}

#[test]
fn clip_and_adjustment_layer_validate_the_entire_authored_schedule() {
    for layer in [false, true] {
        let mut r = request(layer);
        assert!(issues(&r).is_empty());
        impulse(&mut r, layer);
        assert!(issues(&r).is_empty());
        for key in [
            "event0Time",
            "event0X",
            "event0Y",
            "event0Radius",
            "event0VelocityX",
            "event0VelocityY",
            "event0Dye",
        ] {
            let mut invalid = r.clone();
            params(&mut invalid, layer)
                .as_object_mut()
                .unwrap()
                .remove(key);
            assert!(!issues(&invalid).is_empty(), "accepted incomplete {key}");
        }
        for (key, value) in [
            ("event0Time", json!(240000)),
            ("event0Time", json!(0.5)),
            ("event0Radius", json!(0)),
            ("columns", json!(8.5)),
            ("pressureIterations", json!(2)),
            ("durationTicks", json!(999)),
            ("event0Dye", json!(null)),
            ("event0VelocityX", json!("1")),
        ] {
            let mut invalid = r.clone();
            params(&mut invalid, layer)[key] = value;
            assert!(!issues(&invalid).is_empty(), "accepted {key}");
        }
        params(&mut r, layer)["amount"] = json!(0);
        params(&mut r, layer)["columns"] = json!(64);
        params(&mut r, layer)["rows"] = json!(64);
        params(&mut r, layer)["durationTicks"] = json!(3600000);
        assert!(!issues(&r).is_empty(), "amount zero bypassed replay budget");
    }
}

#[test]
fn only_optical_controls_can_be_keyframed() {
    let mut r = request(false);
    impulse(&mut r, false);
    for (key, value, allowed) in [
        ("amount", 0.5, true),
        ("refraction", 0.1, true),
        ("dyeOpacity", 0.5, true),
        ("colorR", 0.3, true),
        ("colorG", 0.3, true),
        ("colorB", 0.3, true),
        ("columns", 16.0, false),
        ("viscosity", 0.01, false),
        ("vorticity", 1.0, false),
        ("startTicks", 0.0, false),
        ("durationTicks", 120000.0, false),
        ("eventCount", 1.0, false),
        ("event0Time", 0.0, false),
    ] {
        r["editing"]["animations"] = json!({format!("effects.fluid.params.{key}"):{"keys":[{
            "id":"k0","time":0,"value":value,"segmentToNext":"linear","tangentMode":"auto"
        }]}});
        assert_eq!(issues(&r).is_empty(), allowed, "{key}: {:?}", issues(&r));
    }
}
